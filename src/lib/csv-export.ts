// @ts-nocheck
/**
 * Generic CSV export utility
 */

export function downloadCSV(data: Record<string, any>[], filename: string) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      }).join(',')
    ),
  ];

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportFinances(expenses: any[], income: any[]) {
  const expenseRows = expenses.map(e => ({
    type: 'Expense',
    date: e.expense_date,
    title: e.title,
    category: e.category,
    amount: e.amount,
    vendor: e.vendor_name || '',
  }));
  const incomeRows = income.map(i => ({
    type: 'Income',
    date: i.income_date,
    title: i.source,
    category: '',
    amount: i.amount,
    vendor: '',
  }));
  downloadCSV([...incomeRows, ...expenseRows], `society-finances-${new Date().toISOString().split('T')[0]}`);
}

export function exportMaintenanceDues(dues: any[]) {
  downloadCSV(
    dues.map(d => ({
      flat: d.flat_identifier,
      month: d.month,
      amount: d.amount,
      status: d.status,
      paid_date: d.paid_date || '',
    })),
    `maintenance-dues-${new Date().toISOString().split('T')[0]}`
  );
}

export function exportVisitorLog(visitors: any[]) {
  downloadCSV(
    visitors.map(v => ({
      name: v.visitor_name,
      phone: v.visitor_phone || '',
      type: v.visitor_type,
      flat: v.flat_number || '',
      status: v.status,
      date: v.expected_date || '',
      checked_in: v.checked_in_at || '',
      checked_out: v.checked_out_at || '',
    })),
    `visitor-log-${new Date().toISOString().split('T')[0]}`
  );
}
