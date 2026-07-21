const fs = require('fs');
const path = require('path');

// Input file name (aapka project backup)
const inputFile = 'PROJECT_FULL_CODE.txt';

function decodeProject() {
    try {
        // 1. Check if the text file exists
        if (!fs.existsSync(inputFile)) {
            console.error(`Error: ${inputFile} nahi mili!`);
            return;
        }

        // 2. Read the whole file
        const content = fs.readFileSync(inputFile, 'utf8');
        
        // 3. Regex to find start and end markers
        // Yeh markers "text.cjs" script ne add kiye the
        const fileRegex = /--- FILE START: (.*?) ---([\s\S]*?)--- FILE END: \1 ---/g;
        
        let match;
        let fileCount = 0;

        console.log("Decoding started...");

        while ((match = fileRegex.exec(content)) !== null) {
            const filePath = match[1].trim(); // e.g. "src\App.tsx"
            const fileContent = match[2];     // File ka asli code

            // Folder path nikalna (e.g. "src" from "src\App.tsx")
            const dir = path.dirname(filePath);

            // 4. Create directory if it doesn't exist
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // 5. Write the file (it rewrites if already available)
            fs.writeFileSync(filePath, fileContent.trimStart(), 'utf8');
            console.log(`✅ Restored: ${filePath}`);
            fileCount++;
        }

        console.log(`\nSuccess! Total ${fileCount} files restore ho gayi hain.`);

    } catch (err) {
        console.error("Decoding mein error aaya:", err);
    }
}

// Start decoding
decodeProject();