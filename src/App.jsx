import React, { useState } from 'react';
import { FileUpload } from './components/FileUpload';
import { parseFile } from './utils/parsers';
import { processData } from './utils/processor';
import { Download, TrendingUp, TrendingDown, DollarSign, Bug } from 'lucide-react';
import Papa from 'papaparse';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">Something went wrong.</h1>
          <pre className="text-left bg-muted p-4 rounded overflow-auto max-w-2xl mx-auto text-xs">
            {this.state.error && this.state.error.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

function Dashboard() {
  const [processedData, setProcessedData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [rawFilesData, setRawFilesData] = useState([]);

  const handleFilesSelected = async (files) => {
    setIsProcessing(true);
    try {
      console.log('Current rawFilesData length:', rawFilesData.length);
      const results = await Promise.all(files.map(parseFile));

      // Combine with existing raw data to prevent overwriting
      // Use functional update to ensure we have the latest state
      setRawFilesData(prevRawFiles => {
        const updatedRawFiles = [...prevRawFiles, ...results];
        console.log('New updatedRawFiles length:', updatedRawFiles.length);

        // We need to process the updated data. 
        // Since setState is async, we can't rely on rawFilesData being updated immediately in the next line.
        // So we use the local variable 'updatedRawFiles' to process.
        const processed = processData(updatedRawFiles);
        setProcessedData(processed);

        return updatedRawFiles;
      });
    } catch (error) {
      console.error("Error parsing files:", error);
      alert("Error processing files. Please check the console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = () => {
    if (!processedData) return;
    const csv = Papa.unparse(processedData.transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'finance_export.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-3xl font-bold text-primary">Personal Finance Dashboard</h1>
            <p className="text-muted-foreground">Upload your bank statements (CSV, Excel, PDF) to get started.</p>
          </div>
          <button
            onClick={() => setDebugMode(!debugMode)}
            className={`p-2 rounded-full ${debugMode ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
            title="Toggle Debug Mode"
          >
            <Bug className="w-5 h-5" />
          </button>
        </div>

        <FileUpload onFilesSelected={handleFilesSelected} />

        {isProcessing && (
          <div className="text-center text-muted-foreground animate-pulse">Processing files...</div>
        )}

        {debugMode && rawFilesData.length > 0 && (
          <div className="space-y-4 p-4 bg-muted/50 rounded-lg border border-dashed border-destructive/50">
            <h2 className="text-lg font-semibold text-destructive flex items-center gap-2">
              <Bug className="w-4 h-4" /> Debug View: Raw Data
            </h2>
            {rawFilesData.map((file, i) => (
              <div key={i} className="space-y-2">
                <h3 className="font-medium">{file.fileName} ({file.type})</h3>
                <div className="bg-card p-4 rounded border overflow-auto max-h-60 text-xs font-mono">
                  <pre>{JSON.stringify(file.data.slice(0, 3), null, 2)}</pre>
                </div>
                <p className="text-xs text-muted-foreground">Showing first 3 rows of raw parsed data.</p>
              </div>
            ))}
          </div>
        )}

        {processedData && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <div className="p-6 bg-card border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Total Income</h3>
                  <TrendingUp className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-2xl font-bold text-green-600">
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(processedData.summary.totalIncome)}
                </p>
              </div>
              <div className="p-6 bg-card border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Total Expense</h3>
                  <TrendingDown className="w-4 h-4 text-red-500" />
                </div>
                <p className="text-2xl font-bold text-red-600">
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(processedData.summary.totalExpense)}
                </p>
              </div>
              <div className="p-6 bg-card border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Net Balance</h3>
                  <DollarSign className="w-4 h-4 text-primary" />
                </div>
                <p className={`text-2xl font-bold ${processedData.summary.net >= 0 ? 'text-primary' : 'text-red-600'}`}>
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(processedData.summary.net)}
                </p>
              </div>
              <div className="p-6 bg-card border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Total Opening Balance</h3>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(processedData.summary.totalOpeningBalance)}
                </p>
              </div>
              <div className="p-6 bg-card border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Total Closing Balance</h3>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(processedData.summary.totalClosingBalance)}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>

            {/* Transactions Table */}
            <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted text-muted-foreground uppercase text-xs">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Account No.</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Source</th>
                    </tr>
                  </thead>
                  <tbody className="bg-card divide-y divide-border">
                    {processedData.transactions.map((txn) => (
                      <tr key={txn.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {new Date(txn.date).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">
                          {txn.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-primary/10 text-primary">
                            {txn.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                          {txn.accountNumber || '-'}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${txn.type === 'credit' ? 'text-green-600' : 'text-red-600'
                          }`}>
                          {txn.type === 'credit' ? '+' : '-'}{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(txn.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                          {txn.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
