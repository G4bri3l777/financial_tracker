import "server-only";

import Papa from "papaparse";

export function parseCSV(csvText: string): string {
  const headerCount: Record<string, number> = {};
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => {
      headerCount[header] = (headerCount[header] || 0) + 1;
      return headerCount[header] > 1 ? `${header}_${headerCount[header]}` : header;
    },
  });
  return (result.data as Array<Record<string, unknown>>)
    .map((row) => JSON.stringify(row))
    .join("\n");
}
