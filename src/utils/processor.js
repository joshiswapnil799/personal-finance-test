import { parse, isValid, format } from 'date-fns';

export function processData(filesData) {
    let allTransactions = [];
    let allBalances = [];

    filesData.forEach(file => {
        const accountNumber = extractAccountNumber(file);
        console.log(`Processing file: ${file.fileName}, Extracted Account Number: ${accountNumber}`);
        // Clone data to avoid reference issues if file.data is reused
        const dataClone = JSON.parse(JSON.stringify(file.data));
        const normalized = normalizeData(dataClone, file.fileName, accountNumber);
        const balances = extractBalances(file, normalized);

        // Validate Balances
        let validationStatus = 'valid';
        let discrepancy = 0;

        if (balances.openingBalance !== null && balances.closingBalance !== null) {
            const totalCredit = normalized.reduce((sum, txn) => txn.type === 'credit' ? sum + txn.amount : sum, 0);
            const totalDebit = normalized.reduce((sum, txn) => txn.type === 'debit' ? sum + txn.amount : sum, 0);

            const expectedClosing = balances.openingBalance + totalCredit - totalDebit;

            // Allow small floating point error
            if (Math.abs(expectedClosing - balances.closingBalance) > 0.01) {
                validationStatus = 'invalid';
                discrepancy = expectedClosing - balances.closingBalance;
                console.warn(`Balance mismatch for ${file.fileName}. Expected: ${expectedClosing.toFixed(2)}, Found: ${balances.closingBalance.toFixed(2)}`);
            }
        }

        // Store balances and validation info
        allBalances.push({
            ...balances,
            fileName: file.fileName,
            validationStatus,
            discrepancy
        });

        allTransactions = [...allTransactions, ...normalized];
    });

    const uniqueTransactions = deduplicateTransactions(allTransactions);
    const summary = summarizeData(uniqueTransactions, allBalances);

    return {
        transactions: uniqueTransactions,
        summary
    };
}

function extractAccountNumber(file) {
    let accountNumber = null;
    // Regex to capture account number.
    // Matches: "Account No: 123", "Acc No. 123", "A/c No : 123", "Cust ID: 123"
    // It captures the number/string after the label.
    const regex = /(?:account\s*no|acc\s*no|a\/c\s*no|account\s*number|cust\s*id)[\s:.-]*([0-9a-z]+)/i;

    const checkLine = (line) => {
        if (!line) return null;
        const match = line.match(regex);
        if (match) return match[1];
        return null;
    };

    if (file.type === 'pdf') {
        for (const line of file.data) {
            const found = checkLine(line);
            if (found) return found;
        }
    } else if (file.type === 'csv') {
        // Check Preamble
        if (file.preamble) {
            console.log('Checking preamble for account number:', file.preamble);
            for (const line of file.preamble) {
                const found = checkLine(line);
                if (found) {
                    console.log('Found account number in preamble:', found);
                    return found;
                }
            }
        }

        // Also check first few rows of data just in case
        // Sometimes the preamble is not correctly separated if header detection failed or if it's mixed
        if (file.data && file.data.length > 0) {
            // Check first row description/values
            const firstRow = file.data[0];
            for (const val of Object.values(firstRow)) {
                if (typeof val === 'string') {
                    const found = checkLine(val);
                    if (found) return found;
                }
            }
        }
    }
    return accountNumber;
}

function extractBalances(file, normalizedTransactions = []) {
    let openingBalance = null;
    let closingBalance = null;

    // Regex patterns
    const openingRegex = /(?:opening|brought|b\/f).{0,20}balance|balance.{0,20}(?:brought|b\/f)/i;
    const closingRegex = /(?:closing|carried|c\/f).{0,20}balance|balance.{0,20}(?:carried|c\/f)/i;

    if (file.type === 'pdf') {
        // PDF: file.data is array of strings (lines)
        const lines = file.data;
        for (const line of lines) {
            if (openingRegex.test(line)) {
                // Try to find the number in this line
                const match = line.match(/[\d,]+\.\d{2}/);
                if (match) openingBalance = parseAmount(match[0]);
            }
            if (closingRegex.test(line)) {
                const match = line.match(/[\d,]+\.\d{2}/);
                if (match) closingBalance = parseAmount(match[0]);
            }
        }
    } else if (file.type === 'csv') {
        // CSV: file.preamble (array of strings) and file.data (array of objects)

        // 1. Check Preamble for both Opening and Closing (just in case)
        if (file.preamble) {
            for (const line of file.preamble) {
                if (openingRegex.test(line)) {
                    const match = line.match(/[\d,]+\.\d{2}/);
                    if (match) openingBalance = parseAmount(match[0]);
                }
                if (closingRegex.test(line)) {
                    const match = line.match(/[\d,]+\.\d{2}/);
                    if (match) closingBalance = parseAmount(match[0]);
                }
            }
        }

        // 2. Check First/Last Rows for explicit Opening/Closing descriptions
        if (file.data && file.data.length > 0) {
            const firstRow = file.data[0];
            const lastRow = file.data[file.data.length - 1];

            // Check first row for Opening Balance
            if (firstRow.description && openingRegex.test(firstRow.description)) {
                openingBalance = firstRow.amount || parseAmount(firstRow.description);
            }

            // Check last row for Closing Balance
            if (lastRow.description && closingRegex.test(lastRow.description)) {
                closingBalance = lastRow.amount || parseAmount(lastRow.description);
            }

            // Also check the raw values of the last row in case 'description' key isn't perfect
            // Iterate over all values of last row
            Object.values(lastRow).forEach(val => {
                if (typeof val === 'string' && closingRegex.test(val)) {
                    const match = val.match(/[\d,]+\.\d{2}/);
                    if (match) closingBalance = parseAmount(match[0]);
                }
            });
        }
    }

    // 3. Fallback: Derive from running balances if available
    if (normalizedTransactions.length > 0) {
        // Sort by date to ensure correct order? 
        // Assuming file data is already chronological or reverse-chronological.
        // Usually statements are chronological (oldest first) or reverse (newest first).
        // Let's assume chronological for now, or check dates.
        // Actually, let's just use the array order as provided by the parser.

        const firstTxn = normalizedTransactions[0];
        const lastTxn = normalizedTransactions[normalizedTransactions.length - 1];

        if (openingBalance === null && firstTxn.balance !== null) {
            // If chronological (first is oldest): Opening = Balance - (Credit - Debit)
            // If reverse (first is newest): Opening = LastTxn.Balance (which would be oldest)
            // Let's assume standard chronological for calculation

            // Logic: Balance AFTER txn = Opening + Credit - Debit
            // So: Opening = Balance - Credit + Debit

            const credit = firstTxn.type === 'credit' ? firstTxn.amount : 0;
            const debit = firstTxn.type === 'debit' ? firstTxn.amount : 0;
            openingBalance = firstTxn.balance - credit + debit;
        }

        if (closingBalance === null && lastTxn.balance !== null) {
            closingBalance = lastTxn.balance;
        }
    }

    return { openingBalance, closingBalance };
}

function normalizeData(data, source, accountNumber = null) {
    if (!Array.isArray(data)) return [];

    return data.map(row => {
        // Handle raw string rows (e.g., from PDF)
        if (typeof row === 'string') {
            return parseStringRow(row, source);
        }

        // Best effort mapping for object rows
        const date = findDate(row);
        const description = findDescription(row);
        const amount = findAmount(row, description); // Pass description to avoid false positives
        const type = findType(row, amount);
        const category = categorizeTransaction(description);
        const balance = findBalance(row);

        // If we can't find a date or amount, it's likely not a transaction row
        if (!date || amount === 0) return null;

        return {
            id: generateId(date, description, amount, accountNumber), // Temporary ID for dedupe
            date,
            description,
            amount: Math.abs(amount),
            type, // 'credit' or 'debit'
            category,
            source,
            accountNumber,
            balance
        };
    }).filter(Boolean);
}

function findBalance(row) {
    const keys = Object.keys(row);
    // Look for 'balance', 'bal', 'running balance'
    // Exclude 'opening balance' or 'closing balance' keys if they exist as separate columns (rare but possible)
    const balanceKey = keys.find(key => {
        const k = key.toLowerCase();
        return (k.includes('balance') || k.includes('bal')) &&
            !k.includes('opening') &&
            !k.includes('closing') &&
            !k.includes('description') && // Avoid 'balance description'
            !k.includes('date'); // Avoid 'balance date'
    });

    if (balanceKey) {
        return parseAmount(row[balanceKey]);
    }
    return null;
}

function parseAmount(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    // Remove currency symbols, commas, etc.
    const cleanStr = str.toString().replace(/[^0-9.-]/g, '');
    return parseFloat(cleanStr);
}

function categorizeTransaction(description) {
    if (!description) return 'Uncategorized';
    const desc = description.toLowerCase();

    // Helper to check for whole word matches
    const matches = (keywords) => {
        return keywords.some(keyword => {
            // Escape special characters for regex
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Look for whole word match or start/end of string
            const regex = new RegExp(`(^|\\s|\\W)${escaped}($|\\s|\\W)`, 'i');
            return regex.test(desc);
        });
    };

    const categories = {
        'Food & Dining': ['swiggy', 'zomato', 'restaurant', 'food', 'cafe', 'coffee', 'starbucks', 'mcdonalds', 'pizza', 'burger', 'hotel', 'dining', 'eats', 'bar', 'pub'],
        'Travel & Transport': ['uber', 'ola', 'rapido', 'metro', 'railway', 'irctc', 'flight', 'airline', 'indigo', 'air india', 'fuel', 'petrol', 'pump', 'toll', 'fastag', 'parking', 'cab', 'auto', 'bus', 'train'],
        'Shopping': ['amazon', 'flipkart', 'myntra', 'ajio', 'retail', 'store', 'mart', 'shop', 'mall', 'ikea', 'decathlon', 'zara', 'h&m', 'uniqlo', 'rel digital', 'croma'],
        'Groceries': ['blinkit', 'zepto', 'bigbasket', 'dmart', 'reliance fresh', 'nature\'s basket', 'grocery', 'supermarket', 'vegetable', 'fruit', 'kirana', 'milk', 'dairy'],
        'Bills & Utilities': ['electricity', 'water', 'gas', 'bill', 'recharge', 'mobile', 'broadband', 'wifi', 'jio', 'airtel', 'vi', 'bsnl', 'tatasky', 'dth', 'bescom', 'adarni', 'mahadiscom'],
        'Health & Wellness': ['pharmacy', 'medical', 'hospital', 'doctor', 'clinic', 'lab', 'health', 'gym', 'fitness', 'medplus', 'apollo', '1mg', 'pharmeasy', 'cult'],
        'Entertainment': ['netflix', 'prime', 'hotstar', 'spotify', 'movie', 'cinema', 'bookmyshow', 'theatre', 'game', 'steam', 'playstation', 'youtube', 'apple'],
        'Investment': ['zerodha', 'groww', 'upstox', 'angel', 'mutual fund', 'sip', 'stocks', 'equity', 'trade', 'investment', 'ppf', 'nps', 'coin', 'kite'],
        'EMI & Loans': ['emi', 'loan', 'finance', 'bajaj', 'credit card', 'payment', 'interest'],
        'Salary': ['salary', 'payroll', 'credit', 'bonus', 'stipend'],
        'Transfer': ['upi', 'transfer', 'imps', 'neft', 'rtgs', 'sent to', 'received from', 'fund transfer', 'remittance']
    };

    for (const [category, keywords] of Object.entries(categories)) {
        if (matches(keywords)) {
            return category;
        }
    }

    return 'Uncategorized';
}

function parseStringRow(line, source) {
    // Basic Regex for common bank statement lines
    // 1. Date (DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD)
    const dateRegex = /(\d{2}[-/]\d{2}[-/]\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/;
    const dateMatch = line.match(dateRegex);

    if (!dateMatch) return null;

    let date = dateMatch[0];
    // Normalize date separators
    date = date.replace(/\//g, '-');

    // Try to parse date to standard format
    try {
        const parts = date.split('-');
        if (parts[0].length === 2) {
            // Assume DD-MM-YYYY -> YYYY-MM-DD
            date = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
    } catch (e) {
        // Keep original if parsing fails
    }

    if (!isValid(new Date(date))) return null;
    date = format(new Date(date), 'yyyy-MM-dd');

    // 2. Amount (Look for numbers with decimals, maybe commas, maybe Cr/Dr suffix)
    // This is tricky as there might be multiple numbers (balance, etc.)
    // We'll look for the last number in the line usually, or explicit Cr/Dr

    // Regex to find potential amounts: 1,234.56 or 1234.56
    // Exclude date-like patterns
    const amountRegex = /([\d,]+\.\d{2})(?:\s*(Cr|Dr|Credit|Debit))?/gi;
    const amounts = [...line.matchAll(amountRegex)];

    if (amounts.length === 0) return null;

    // Heuristic: If 'Cr'/'Dr' is present, use that.
    // Otherwise, assume the last number is the balance and the second to last is the transaction amount? 
    // Or just take the largest number? Or the first one?
    // Let's try to find one with Cr/Dr first.

    let amount = 0;
    let type = 'debit';
    let description = line.replace(dateMatch[0], '').trim();

    const explicitTypeMatch = amounts.find(m => m[2]);

    if (explicitTypeMatch) {
        amount = parseFloat(explicitTypeMatch[1].replace(/,/g, ''));
        type = explicitTypeMatch[2].toLowerCase().startsWith('c') ? 'credit' : 'debit';
        // Remove amount from description
        description = description.replace(explicitTypeMatch[0], '').trim();
    } else {
        // Fallback: Use the last number found (often amount or balance)
        // This is risky. Let's try to be smarter.
        // If there are two numbers, usually [Debit, Credit, Balance] or [Amount, Balance]
        // For now, let's pick the first number found after the date?

        // Let's just take the first number found for now as a simple heuristic
        const match = amounts[0];
        amount = parseFloat(match[1].replace(/,/g, ''));

        // Try to guess type from keywords in description
        if (/credit|deposit|refund|interest/i.test(line)) {
            type = 'credit';
        }

        description = description.replace(match[0], '').trim();
    }

    // Clean up description
    description = description.replace(/\s+/g, ' ').trim();

    return {
        id: generateId(date, description, amount),
        date,
        description,
        amount: Math.abs(amount),
        type,
        category: categorizeTransaction(description),
        source
    };
}

function findDate(row) {
    const dateKeys = ['date', 'txn date', 'transaction date', 'value date', 'booking date', 'post date'];
    for (const key of Object.keys(row)) {
        if (dateKeys.some(k => key.toLowerCase().includes(k))) {
            let val = row[key];
            if (!val) continue;

            // If val is a string, clean it up (remove time if present for simpler parsing)
            if (typeof val === 'string') {
                // Remove time part if it exists (e.g., "01-08-2025 01:33:26" -> "01-08-2025")
                // Match YYYY-MM-DD or DD-MM-YYYY or MM/DD/YYYY at the start
                const dateMatch = val.match(/^(\d{2,4}[-/]\d{1,2}[-/]\d{2,4})/);
                if (dateMatch) {
                    val = dateMatch[1];
                }
            }

            // Try parsing common formats
            const date = new Date(val);
            if (isValid(date)) return format(date, 'yyyy-MM-dd');

            // Try manual parsing for DD/MM/YYYY or DD-MM-YYYY if standard fails
            if (typeof val === 'string') {
                const parts = val.split(/[-/]/);
                if (parts.length === 3) {
                    // Check if first part is likely year (4 digits)
                    if (parts[0].length === 4) {
                        // YYYY-MM-DD
                        const d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
                        if (isValid(d)) return format(d, 'yyyy-MM-dd');
                    } else {
                        // Assume DD-MM-YYYY (Indian/UK format)
                        // This is ambiguous with MM-DD-YYYY, but in finance context DD-MM is more common globally except US
                        // We can try to be smart: if parts[1] > 12, it must be MM-DD-YYYY (where parts[0] is MM)? No, MM cannot be > 12.
                        // If parts[0] > 12, it MUST be DD-MM-YYYY.

                        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                        if (isValid(d)) return format(d, 'yyyy-MM-dd');
                    }
                }
            }
        }
    }
    return null;
}

function findDescription(row) {
    const descKeys = ['description', 'narration', 'particulars', 'details', 'remarks', 'memo', 'transaction details'];
    for (const key of Object.keys(row)) {
        if (descKeys.some(k => key.toLowerCase().includes(k))) {
            return row[key];
        }
    }
    // Fallback: longest string value that isn't a date
    let longest = '';
    for (const val of Object.values(row)) {
        if (typeof val === 'string' && val.length > longest.length && !isValid(new Date(val))) {
            longest = val;
        }
    }
    return longest;
}

function findAmount(row) {
    // Check for explicit Credit/Debit columns first
    const creditKeys = ['credit', 'deposit', 'amount cr']; // Removed simple 'cr' to avoid false positives
    const debitKeys = ['debit', 'withdrawal', 'amount dr']; // Removed simple 'dr'

    let credit = 0;
    let debit = 0;

    // Identify description column first to exclude it
    const descKeys = ['description', 'narration', 'particulars', 'details', 'remarks', 'memo'];

    for (const key of Object.keys(row)) {
        const lowerKey = key.toLowerCase();

        // Skip if it's likely a description column
        if (descKeys.some(k => lowerKey === k || lowerKey.includes(k))) continue;

        // Strict check for 'cr' and 'dr'
        const isCr = lowerKey === 'cr' || lowerKey.endsWith(' cr') || lowerKey.startsWith('cr ') || lowerKey.includes('(cr)');
        const isDr = lowerKey === 'dr' || lowerKey.endsWith(' dr') || lowerKey.startsWith('dr ') || lowerKey.includes('(dr)');

        // Remove currency symbols and commas
        const cleanVal = String(row[key]).replace(/[^0-9.-]/g, '');
        const val = parseFloat(cleanVal);

        if (isNaN(val)) continue;

        if (creditKeys.some(k => lowerKey === k || lowerKey.includes(k)) || isCr) {
            credit = val;
        } else if (debitKeys.some(k => lowerKey === k || lowerKey.includes(k)) || isDr) {
            debit = val;
        }
    }

    if (credit > 0) return credit;
    if (debit > 0) return -debit;

    // Check for generic Amount column
    const amountKeys = ['amount', 'txn amount', 'transaction amount', 'inr'];
    for (const key of Object.keys(row)) {
        if (amountKeys.some(k => key.toLowerCase().includes(k))) {
            const cleanVal = String(row[key]).replace(/[^0-9.-]/g, '');
            const val = parseFloat(cleanVal);
            if (!isNaN(val)) return val;
        }
    }

    return null;
}

function findType(row, amount) {
    // If amount is negative, it means it came from a Debit column or was explicitly negative.
    // We should trust this over any ambiguous "Type" or "Dr/Cr" column which might refer to Balance.
    if (amount < 0) return 'debit';

    // Check type column first for positive amounts
    const typeKeys = ['type', 'd/c', 'cr/dr', 'transaction type', 'dr / cr'];
    for (const key of Object.keys(row)) {
        if (typeKeys.some(k => key.toLowerCase().includes(k))) {
            const val = String(row[key]).toLowerCase();
            if (val.includes('cr') || val.includes('credit') || val.includes('deposit')) return 'credit';
            if (val.includes('dr') || val.includes('debit') || val.includes('withdrawal')) return 'debit';
        }
    }

    return 'credit'; // Default to credit if positive and no type info
}

function generateId(date, description, amount, accountNumber) {
    return `${date}-${description}-${amount}-${accountNumber || 'unknown'}`.replace(/\s+/g, '').toLowerCase();
}

function deduplicateTransactions(transactions) {
    const unique = new Map();
    transactions.forEach(txn => {
        unique.set(txn.id, txn);
    });
    return Array.from(unique.values());
}

function summarizeData(transactions, balances = []) {
    const byCategory = {};
    const byMonth = {};
    let totalIncome = 0;
    let totalExpense = 0;

    // Aggregate balances
    let totalOpeningBalance = 0;
    let totalClosingBalance = 0;

    if (balances && balances.length > 0) {
        balances.forEach(b => {
            if (b.openingBalance !== null) totalOpeningBalance += b.openingBalance;
            if (b.closingBalance !== null) totalClosingBalance += b.closingBalance;
        });
    }

    transactions.forEach(txn => {
        // Category
        if (!byCategory[txn.category]) byCategory[txn.category] = 0;
        byCategory[txn.category] += txn.amount;

        // Month
        const month = txn.date.substring(0, 7); // YYYY-MM
        if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };

        if (txn.type === 'credit') {
            totalIncome += txn.amount;
            byMonth[month].income += txn.amount;
        } else {
            totalExpense += txn.amount;
            byMonth[month].expense += txn.amount;
        }
    });

    return {
        byCategory,
        byMonth,
        totalIncome,
        totalExpense,
        net: totalIncome - totalExpense,
        totalOpeningBalance,
        totalClosingBalance
    };
}
