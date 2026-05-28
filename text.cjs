const fs = require('fs');
const path = require('path');

const outputFile = 'PROJECT_FULL_CODE.txt';
const sourceDir = path.join(__dirname, 'src');

// Files to ignore (saves space)
const ignoreFiles = ['.DS_Store', 'vite-env.d.ts', 'logo.png', 'react.svg'];
const ignoreExts = ['.css', '.json', '.svg', '.png', '.jpg'];

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (!ignoreFiles.includes(file) && !ignoreExts.includes(path.extname(file))) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

try {
    const allFiles = getAllFiles(sourceDir, []);
    let content = "PROJECT DOCUMENTATION\n=====================\n\n";

    allFiles.forEach(file => {
        // Get relative path for clarity
        const relativePath = path.relative(__dirname, file);
        content += `\n\n--- FILE START: ${relativePath} ---\n`;
        content += fs.readFileSync(file, 'utf8');
        content += `\n--- FILE END: ${relativePath} ---\n`;
    });

    fs.writeFileSync(outputFile, content);
    console.log(`✅ SUCCESS! Created '${outputFile}'.`);
    console.log(`👉 Please attach or copy the content of this file to the AI chat.`);
} catch (e) {
    console.error("Error generating context:", e);
}