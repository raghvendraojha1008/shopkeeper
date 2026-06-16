import React from 'react';
import { Virtuoso } from 'react-virtuoso';

interface VirtualizedListProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  loadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  itemClassName?: string;
}

function VirtualizedList<T>({
  data,
  renderItem,
  loadMore,
  hasMore = false,
  loading = false,
  emptyMessage = 'No items found',
  className = '',
  itemClassName = '',
}: VirtualizedListProps<T>) {
  if (data.length === 0 && !loading) {
    return (
      <div className={`flex items-center justify-center py-16 text-slate-400 ${className}`}>
        <div className="text-center">
          <div className="text-sm font-bold">{emptyMessage}</div>
        </div>
      </div>
    );
  }

  return (
    <Virtuoso
      className={className}
      style={{ height: '100%' }}
      data={data}
      endReached={() => {
        if (hasMore && !loading && loadMore) {
          loadMore();
        }
      }}
      overscan={200}
      itemContent={(index, item) => (
        <div className={itemClassName}>
          {renderItem(item, index)}
        </div>
      )}
      components={{
        Footer: () =>
          loading ? (
            <div className="py-4 text-center">
              <div className="inline-flex items-center gap-2 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                Loading more...
              </div>
            </div>
          ) : hasMore ? (
            <div className="py-4 text-center">
              <button
                onClick={loadMore}
                className="text-sm font-bold text-blue-600 hover:underline"
              >
                Load more
              </button>
            </div>
          ) : data.length > 0 ? (
            <div className="py-4 text-center text-xs text-[rgba(148,163,184,0.45)]">
              All items loaded
            </div>
          ) : null,
      }}
    />
  );
}

export default VirtualizedList;







