import { main } from './program.js';

main(process.argv).then((code) => {
  process.exitCode = code;
});
