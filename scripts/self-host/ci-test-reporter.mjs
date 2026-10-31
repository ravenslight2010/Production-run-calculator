// Bounded annotations for this workflow's synthetic, credential-free Node tests.
// Preserve the normal spec reporter and Node's original failing exit status.
export function failureAnnotation(data) {
  const error = data?.details?.error;
  const message = error?.cause?.message ?? error?.message ?? 'test failed';
  const text = `${String(data?.name ?? 'unnamed contract')}: ${String(message)}`
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '?').slice(0, 1800);
  // GitHub workflow-command data escaping, not an arbitrary command/property.
  return `::error title=Self-host synthetic contract::${text.replaceAll('%', '%25')
    .replaceAll('\r', '%0D').replaceAll('\n', '%0A')}\n`;
}
export default async function* reporter(events) {
  for await (const event of events) {
    if (event.type === 'test:fail') yield failureAnnotation(event.data);
  }
}
