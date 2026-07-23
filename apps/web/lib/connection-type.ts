import { CONNECTION_TYPES, type ConnectionType } from '@netverdict/contracts';

/**
 * The Network Information API (`navigator.connection`) is non-standard —
 * shipped in Chromium, absent from Firefox and Safari — and isn't in
 * TypeScript's DOM lib. This reads it defensively and falls back to
 * `'unknown'` rather than guessing, consistent with §5.7: an
 * unmeasurable condition is reported honestly, never invented.
 */
interface NetworkInformationLike {
  type?: string;
}

function isConnectionType(value: string): value is ConnectionType {
  return (CONNECTION_TYPES as readonly string[]).includes(value);
}

export function detectConnectionType(): ConnectionType {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }
  // Cast through `unknown` rather than the DOM lib's `Navigator` type: this
  // function is called from both a plain window context and a Worker's
  // `WorkerNavigator` context (a different, incompatible ambient type), and
  // `connection` isn't declared on either in TypeScript's lib anyway.
  const connection = (navigator as unknown as { connection?: NetworkInformationLike }).connection;
  const reportedType = connection?.type;
  if (reportedType && isConnectionType(reportedType)) {
    return reportedType;
  }
  return 'unknown';
}
