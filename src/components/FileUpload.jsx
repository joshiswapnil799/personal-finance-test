import React, { useCallback, useState } from 'react';
import { Upload, File, X } from 'lucide-react';
import { cn } from '../lib/utils';

export function FileUpload({ onFilesSelected }) {
    const [isDragging, setIsDragging] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        addFiles(files);
    }, []);

    const handleFileInput = useCallback((e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            addFiles(files);
        }
        // Reset value to allow selecting the same file again if needed
        e.target.value = '';
    }, []);

    const addFiles = (newFiles) => {
        // Filter for allowed types if needed, for now accept all and validate later
        setSelectedFiles(prev => [...prev, ...newFiles]);
        if (onFilesSelected) {
            onFilesSelected(newFiles);
        }
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div
                className={cn(
                    "relative border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
                    isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
                    "flex flex-col items-center justify-center gap-4"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
            >
                <input
                    id="file-input"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                    accept=".csv,.xlsx,.xls,.pdf"
                />
                <div className="p-4 bg-muted rounded-full">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                    <p className="text-lg font-medium">
                        Drop your bank statements here
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Supports CSV, Excel, and PDF
                    </p>
                </div>
            </div>

            {selectedFiles.length > 0 && (
                <div className="mt-6 space-y-3">
                    <h3 className="font-medium text-sm text-muted-foreground">Selected Files</h3>
                    <div className="space-y-2">
                        {selectedFiles.map((file, index) => (
                            <div key={`${file.name}-${index}`} className="flex items-center justify-between p-3 bg-card border rounded-md shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-primary/10 rounded">
                                        <File className="w-4 h-4 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{file.name}</p>
                                        <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeFile(index)}
                                    className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
