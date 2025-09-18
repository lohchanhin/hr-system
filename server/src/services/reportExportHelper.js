function sanitizeFileName(name = 'report') {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'report';
}

export async function exportTabularReport(
  res,
  { format = 'excel', fileName = 'report', sheetName = 'Report', title, columns = [], rows = [], summaryRows = [] }
) {
  const safeName = sanitizeFileName(fileName);
  const finalColumns = Array.isArray(columns) ? columns : [];
  const dataRows = Array.isArray(rows) ? rows : [];
  const summaries = Array.isArray(summaryRows) ? summaryRows : [];

  if (format === 'pdf') {
    let PDFDocument;
    try {
      PDFDocument = (await import('pdfkit')).default;
    } catch (err) {
      throw new Error('pdfkit module not installed');
    }
    const doc = new PDFDocument({ margin: 36 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    doc.pipe(res);

    if (title) {
      doc.fontSize(16).text(String(title), { align: 'center' });
      doc.moveDown();
    }

    if (finalColumns.length) {
      doc.fontSize(12);
      doc.text(finalColumns.map((col) => col.header ?? col.key ?? '').join(' | '));
      doc.moveDown(0.5);
      dataRows.forEach((row) => {
        const line = finalColumns
          .map((col) => {
            const value = row[col.key];
            return value === undefined || value === null ? '' : String(value);
          })
          .join(' | ');
        doc.text(line);
      });
    }

    if (summaries.length) {
      doc.moveDown();
      summaries.forEach(({ label, value }) => {
        doc.text(`${label ?? ''}: ${value ?? ''}`);
      });
    }

    doc.end();
    return;
  }

  let ExcelJS;
  try {
    ExcelJS = (await import('exceljs')).default;
  } catch (err) {
    throw new Error('exceljs module not installed');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName || 'Report');
  worksheet.columns = finalColumns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 20,
  }));

  dataRows.forEach((row) => {
    worksheet.addRow(row);
  });

  if (summaries.length && finalColumns.length >= 2) {
    worksheet.addRow({});
    const labelKey = finalColumns[0].key;
    const valueKey = finalColumns[1].key;
    summaries.forEach(({ label, value }) => {
      const summaryRow = {};
      summaryRow[labelKey] = label;
      summaryRow[valueKey] = value;
      worksheet.addRow(summaryRow);
    });
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(buffer);
}
