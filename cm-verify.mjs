import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node cm-verify.mjs <file>");
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  
  // Parse the file to check for syntax errors
  const diagnostics = ts.getPreEmitDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    console.error(`PARSE ERROR in ${filePath}`);
    process.exit(1);
  }
  
  console.log(`ok ${filePath}`);
} catch (e) {
  console.error(`CODE CHANGED or PARSE ERROR in ${filePath}: ${e.message}`);
  process.exit(1);
}
