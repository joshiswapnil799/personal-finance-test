import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source for PDF.js
// In Vite, we can import the worker script as a URL
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function parseFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === 'csv') {
        return parseCSV(file);
    } else if (['xls', 'xlsx'].includes(extension)) {
        return parseExcel(file);
    } else if (extension === 'pdf') {
        return parsePDF(file);
    } else {
        throw new Error(`Unsupported file format: ${extension}`);
    }
}

function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: false, // Parse as arrays first to find the real header
            skipEmptyLines: true,
            complete: (results) => {
                const rows = results.data;
                let headerRowIndex = -1;

                // Heuristic to find the header row
                // Look for a row containing 'Date' and 'Amount' or similar keywords
                const commonHeaders = ['date', 'txn date', 'description', 'narration', 'amount', 'debit', 'credit', 'balance'];

                for (let i = 0; i < Math.min(rows.length, 20); i++) { // Check first 20 rows
                    const rowStr = rows[i].map(cell => String(cell).toLowerCase()).join(' ');
                    const matchCount = commonHeaders.filter(h => rowStr.includes(h)).length;

                    // If we find at least 2 common headers, assume this is the header row
                    if (matchCount >= 2) {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    // Fallback: If no header found, maybe it's a simple CSV without headers? 
                    // Or maybe the first row IS the header but didn't match enough keywords?
                    // Let's try to use the first row as header if it has string values
                    headerRowIndex = 0;
                }

                const headers = rows[headerRowIndex].map(h => String(h).trim());
                const preamble = rows.slice(0, headerRowIndex).map(row => row.join(' ')); // Join cells for easier regex
                const data = [];

                for (let i = headerRowIndex + 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length !== headers.length) {
                        // Handle mismatch length if needed, or just map what we can
                    }

                    const rowObj = {};
                    headers.forEach((header, index) => {
                        if (header) { // Only map if header is not empty
                            rowObj[header] = row[index];
                        }
                    });
                    data.push(rowObj);
                }

                resolve({
                    fileName: file.name,
                    type: 'csv',
                    data: data,
                    preamble: preamble,
                    meta: { ...results.meta, headerRowIndex }
                });
            },
            error: (error) => {
                reject(error);
            }
        });
    });
}

function parseExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                resolve({
                    fileName: file.name,
                    type: 'excel',
                    data: jsonData
                });
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

async function parsePDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        // Basic parsing of text to lines for now
        // TODO: Implement specific PDF table extraction logic
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        return {
            fileName: file.name,
            type: 'pdf',
            data: lines, // Raw text lines for now
            rawText: fullText
        };
    } catch (error) {
        console.error("Error parsing PDF:", error);
        throw error;
    }
}
