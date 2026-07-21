import os

# Root directory to scan
root_dir = r"C:\Users\ragha\OneDrive\Desktop\shopkeeper-v2"

# Output file
output_file = r"C:\Users\ragha\Downloads\files_structure.txt"

with open(output_file, "w", encoding="utf-8") as f:
    for root, dirs, files in os.walk(root_dir):
        for file in files:
            full_path = os.path.join(root, file)
            f.write(full_path + "\n")

print(f"Leaf file paths saved to: {output_file}")
