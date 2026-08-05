#!/usr/bin/env node
const bcrypt = require('bcryptjs');

/* ────────────────────────────── yarn hash-password ──────────────────────────────
   Prints the line to paste into .env or Vercel. The password itself is typed here and
   nowhere else: what comes out is a bcrypt hash, which is safe to keep in an environment
   variable, read off a screen or lose in a shell history, because it cannot be turned back
   into the password.

   Cost 10 to match the admin password. bcryptjs is pure JavaScript and several times slower
   than the native binding, so 12 — the number you will read elsewhere — would put every
   login attempt near a second of serverless CPU for a password shared with ten people.   */

const COST = 10;

/** Piping (`echo haslo | yarn hash-password`) fires both `data` and `end`, and hashing twice
 *  would print two different hashes for one password — a genuinely confusing thing to read. */
let done = false;

function print(password) {
  if (done) return;
  done = true;

  if (!password) {
    console.error('Puste hasło. Nic nie zahashowano.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Hasło za krótkie. Daj co najmniej 8 znaków.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, COST);

  console.log('\nWklej to do .env:\n');
  console.log(`ACCESS_PASSWORD_HASH='${hash}'`);
  console.log('\nDo Vercela / panelu — sama wartość, BEZ apostrofów:\n');
  console.log(hash);
  console.log(
    '\nApostrofy są dla powłoki: hash zawiera $, więc `export X=' +
      hash.slice(0, 7) +
      '…` bez\nnich rozwinęłoby się w kawałki. Sam plik .env radzi sobie z oboma formami,' +
      '\nale w polu w panelu apostrof stałby się częścią hasha i nic by już nie pasowało.' +
      '\n\nHasło rozdaj osobno — tego hasha nie da się odwrócić.\n'
  );
}

const fromArgv = process.argv.slice(2).join(' ').trim();

if (fromArgv) {
  // Handy in a pinch, but it lands in ~/.bash_history and in the process list. The stdin path
  // below does not, which is why it is the one the docs show.
  print(fromArgv);
} else {
  process.stdout.write('Hasło (będzie widoczne): ');
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;
    process.stdin.pause();
    print(buffer.slice(0, newline).trim());
  });
  process.stdin.on('end', () => print(buffer.trim()));
}
