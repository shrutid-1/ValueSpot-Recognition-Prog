import { format } from 'date-fns'

/**
 * File export helpers.
 *
 * `xlsx` and `file-saver` are loaded with dynamic import() rather than at the
 * top of the file. They are only needed the moment somebody actually clicks
 * Export, and `xlsx` alone is the largest single dependency in the project —
 * statically importing it put the whole spreadsheet writer into the Reports
 * route chunk, so it downloaded for everyone who merely opened the page.
 *
 * Both functions are already async from the caller's point of view (they
 * trigger a download and return nothing), so awaiting the import costs
 * nothing perceptible on first use and nothing at all afterwards — the module
 * is cached once fetched.
 */

/** Turn rows into RFC-4180-ish CSV. Pure; no I/O, no heavy dependency. */
function toCsv(data: Record<string, unknown>[]): string {
  const headers = Object.keys(data[0])

  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h]
      if (val === null || val === undefined) return ''
      const str = String(val)
      // Escape quotes and wrap when the value contains a comma/newline/quote.
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }).join(','),
  )

  return [headers.join(','), ...rows].join('\n')
}

function stamped(filename: string, ext: string): string {
  return `${filename}_${format(new Date(), 'yyyy-MM-dd')}.${ext}`
}

/** Export data as a CSV file. */
export async function exportCSV(
  data: Record<string, unknown>[],
  filename: string,
): Promise<void> {
  if (data.length === 0) return

  const { saveAs } = await import('file-saver')

  // The BOM keeps Excel from mangling non-ASCII names.
  const blob = new Blob(['﻿' + toCsv(data)], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, stamped(filename, 'csv'))
}

/** Export one or more sheets as an XLSX workbook. */
export async function exportXLSX(
  sheets: Array<{ name: string; data: Record<string, unknown>[] }>,
  filename: string,
): Promise<void> {
  const [XLSX, { saveAs }] = await Promise.all([
    import('xlsx'),
    import('file-saver'),
  ])

  const workbook = XLSX.utils.book_new()

  sheets.forEach(({ name, data }) => {
    const worksheet = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31)) // Excel's 31-char limit
  })

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, stamped(filename, 'xlsx'))
}
