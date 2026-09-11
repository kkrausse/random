import { parse, modify, applyEdits } from 'jsonc-parser';

const input = '{ /* retained comment */ "value": 1 }';
if (parse(input).value !== 1) throw new Error('parse failed');
const output = applyEdits(input, modify(input, ['value'], 2, {}));
if (parse(output).value !== 2 || !output.includes('retained comment')) {
  throw new Error('edit failed');
}
console.log('JSONC_PARSE_EDIT_DONE');
