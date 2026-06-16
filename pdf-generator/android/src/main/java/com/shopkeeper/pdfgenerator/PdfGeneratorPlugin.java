package com.shopkeeper.pdfgenerator;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "PdfGenerator")
public class PdfGeneratorPlugin extends Plugin {

    private PdfGenerator implementation = new PdfGenerator();

    @PluginMethod
    public void generate(PluginCall call) {
        JSObject data = call.getObject("data");
        String title = call.getString("title", "Document");
        String fileName = call.getString("fileName", title + ".pdf");

        // Get the app's cache directory for output
        File outputDir = getContext().getCacheDir();

        try {
            File pdfFile = implementation.generatePdf(data, outputDir, fileName);
            JSObject ret = new JSObject();
            ret.put("uri", pdfFile.toURI().toString());
            ret.put("path", pdfFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("PDF generation failed: " + e.getMessage(), e);
        }
    }
}