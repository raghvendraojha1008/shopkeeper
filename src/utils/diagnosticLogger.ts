/**
 * Diagnostic Logger for Android Capacitor WebView
 * 
 * Captures detailed error information and network failures to help debug
 * add/edit failures on low-memory Android devices.
 * 
 * Usage: diagnosticLogger.captureError(error) or just use in console
 */

interface DiagnosticEntry {
  timestamp: string;
  type: 'error' | 'warn' | 'info' | 'network' | 'write';
  message: string;
  details?: any;
  stack?: string;
}

class DiagnosticLogger {
  private logs: DiagnosticEntry[] = [];
  private maxLogs = 100;
  private isAndroid = () => /Android/.test(navigator.userAgent);

  private addLog(entry: DiagnosticEntry) {
    this.logs.push(entry);
    // Keep only recent logs in memory to avoid memory bloat
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // Always log to console for visibility in Android logcat
    const prefix = `[${entry.type.toUpperCase()}]`;
    if (entry.details) {
      console.log(`${prefix} ${entry.message}`, entry.details);
    } else {
      console.log(`${prefix} ${entry.message}`);
    }
  }

  error(message: string, error?: any) {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      message,
      details: error ? {
        message: error?.message,
        code: error?.code,
        name: error?.name,
      } : undefined,
      stack: error?.stack,
    };
    this.addLog(entry);
  }

  warn(message: string, details?: any) {
    this.addLog({
      timestamp: new Date().toISOString(),
      type: 'warn',
      message,
      details,
    });
  }

  info(message: string, details?: any) {
    this.addLog({
      timestamp: new Date().toISOString(),
      type: 'info',
      message,
      details,
    });
  }

  networkError(method: string, url: string, status: number, error?: any) {
    this.addLog({
      timestamp: new Date().toISOString(),
      type: 'network',
      message: `${method} ${url} failed with status ${status}`,
      details: {
        method,
        url,
        status,
        error: error?.message,
      },
    });
  }

  writeError(collection: string, operation: string, error?: any) {
    this.addLog({
      timestamp: new Date().toISOString(),
      type: 'write',
      message: `Firestore write failed: ${operation} to ${collection}`,
      details: {
        collection,
        operation,
        error: error?.message,
        code: error?.code,
      },
      stack: error?.stack,
    });
  }

  getLogs(): string {
    return this.logs.map(log => {
      let str = `[${log.timestamp}] ${log.type.toUpperCase()}: ${log.message}`;
      if (log.details) {
        str += ` | ${JSON.stringify(log.details)}`;
      }
      return str;
    }).join('\n');
  }

  dumpToConsole() {
    console.log('=== DIAGNOSTIC LOG DUMP ===');
    console.log(this.getLogs());
    console.log('=== END DIAGNOSTIC LOG ===');
  }

  /**
   * Format logs for sending to a logging service or displaying in UI
   */
  export(): DiagnosticEntry[] {
    return [...this.logs];
  }
}

export const diagnosticLogger = new DiagnosticLogger();

/**
 * Global error handler for uncaught errors
 * Automatically capture any unhandled errors to diagnostic log
 */
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = function(...args: any[]) {
    originalError.apply(console, args);
    // Capture the first argument if it looks like an error
    if (args[0] instanceof Error) {
      diagnosticLogger.error('Uncaught error', args[0]);
    } else if (typeof args[0] === 'string') {
      diagnosticLogger.error(args[0], args[1]);
    }
  };

  // Global error event listener
  window.addEventListener('error', (event) => {
    diagnosticLogger.error(
      `Uncaught error: ${event.message}`,
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }
    );
  });

  // Unhandled promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    diagnosticLogger.error(
      'Unhandled promise rejection',
      event.reason instanceof Error ? event.reason : { reason: event.reason }
    );
  });
}
