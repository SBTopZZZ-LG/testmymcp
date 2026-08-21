// Unhappy fixture: accepts every request but never responds (hangs). It exits
// cleanly (0) on stdin close so the transport can terminate it gracefully —
// the hang is bounded by the client's deadline, not infinite.
import { onLine } from '../helpers/stdio.js';

onLine(() => null);
