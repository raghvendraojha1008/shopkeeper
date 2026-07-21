package com.shopkeeper.pdfgenerator;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.pdf.PdfDocument;
import android.os.Build;
import android.util.Log;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@RequiresApi(api = Build.VERSION_CODES.KITKAT)
public class PdfGenerator {

    public File generatePdf(JSObject data, File outputDir, String fileName) throws Exception {
        PdfDocument document = new PdfDocument();

        try {
            // Parse sections from JSObject
            JSONObject jsonData = new JSONObject(data.toString());
            JSONArray sectionsArray = jsonData.getJSONArray("sections");

            // Manual conversion to List (compatible with older APIs)
            List<Object> sections = new ArrayList<>();
            for (int i = 0; i < sectionsArray.length(); i++) {
                sections.add(sectionsArray.get(i));
            }

            // Page setup
            PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(595, 842, 1).create();
            PdfDocument.Page page = document.startPage(pageInfo);
            Canvas canvas = page.getCanvas();
            Paint paint = new Paint();
            paint.setTextSize(12);

            int y = 40;
            for (Object sectionObj : sections) {
                JSONObject section = (JSONObject) sectionObj;
                String type = section.optString("type", "text");

                if ("text".equals(type)) {
                    String content = section.optString("content", "");
                    canvas.drawText(content, 40, y, paint);
                    y += 20;
                } else if ("table".equals(type)) {
                    JSONArray rows = section.optJSONArray("rows");
                    if (rows != null) {
                        for (int r = 0; r < rows.length(); r++) {
                            JSONArray row = rows.getJSONArray(r);
                            StringBuilder rowText = new StringBuilder();
                            for (int c = 0; c < row.length(); c++) {
                                if (c > 0)
                                    rowText.append(" | ");
                                rowText.append(row.optString(c, ""));
                            }
                            canvas.drawText(rowText.toString(), 40, y, paint);
                            y += 20;
                        }
                        y += 10;
                    }
                }

                if (y > 800) {
                    document.finishPage(page);
                    pageInfo = new PdfDocument.PageInfo.Builder(595, 842, document.getPages().size() + 1).create();
                    page = document.startPage(pageInfo);
                    canvas = page.getCanvas();
                    y = 40;
                }
            }

            document.finishPage(page);

            // Save file
            File outputFile = new File(outputDir, fileName);
            FileOutputStream fos = new FileOutputStream(outputFile);
            document.writeTo(fos);
            fos.close();

            return outputFile;
        } finally {
            document.close();
        }
    }
}