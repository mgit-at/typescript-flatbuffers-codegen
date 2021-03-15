import md5 from 'md5';
import * as ebnfParser from './ebnf';
import {checkReserved} from '../checkReserved';

export class EbnfGenerator {
    private ebnf: ebnfParser.Grammar;

    private readonly seed: string;
    private readonly wordList: string[];
    private readonly maxCount: number;

    private readonly charList = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

    private sequence: number = 0;

    private usedNames = new Set<string>();
    private usedNamesNamed = new Map<string, string[]>();
    private usedNamesNamedCounter = new Map<string, number>();

    constructor(ebnfFile: string, seed: string, wordlist: string[] = [], maxRepeatCount: number = 1) {
        this.seed = seed;
        this.wordList = wordlist;
        this.maxCount = maxRepeatCount;

        if (this.wordList) {
            let wordListError = false;
            this.wordList.forEach((v) => {
                if (!checkReserved(v)) {
                    wordListError = true;

                    console.error(`Reserved word in wordlist: '${v}'`);
                }

                if (!v.match(/^[a-z]+$/)) {
                    wordListError = true;

                    console.error(`Invalid word in wordlist: ${v}`);
                }
            });

            if (wordListError) {
                throw 'invalid words in wordlist, check output';
            }
        }

        this.ebnf = ebnfParser.parse(ebnfFile);
    }

    generateSchema() {
        this.ebnf.rules.forEach((r) => {
            if (r.name.endsWith('IDENTIFIER')) {
                if (r.name.length === 10) {
                    r.expression = {
                        type: 'gentext',
                        strType: '',
                        useGenerated: false
                    };

                    return;
                }

                if (r.name.startsWith('GEN')) {
                    r.expression = {
                        type: 'gentext',
                        strType: r.name.substring(4, r.name.length - 11),
                        useGenerated: false
                    };

                    return;
                }

                if (r.name.startsWith('USE')) {
                    r.expression = {
                        type: 'gentext',
                        strType: r.name.substring(4, r.name.length - 11),
                        useGenerated: true
                    };
                }

                return;
            }

            if (r.name === 'GEN_DIGIT') {
                r.expression = {
                    type: 'gendigit',
                };
            }
        });

        let possibilities = this.processExpression(this.findRule('SCHEMA')!.expression);
        possibilities.sort((a, b) => {
            if (a.includes('t##')) {
                return 1;
            }

            return -1;
        }).forEach((s, k) => {
            s = s.replace(/##(?:.+?);(.*?);([tf])##/g, (p, type, useGenerated) => {
                if (useGenerated === 't') {
                    let counter = this.usedNamesNamedCounter.get(type);
                    if (counter === undefined) {
                        this.usedNamesNamedCounter.set(type, 0);
                        counter = 1;
                    }

                    let strForType = this.usedNamesNamed.get(type);
                    if (strForType) {
                        if (strForType.length <= counter) {
                            counter = 0;
                        }

                        this.usedNamesNamedCounter.set(type, counter + 1);

                        return strForType[counter];
                    }
                }

                let replacement = this.generateName('');

                let c = this.usedNamesNamed.get(type);
                if (!c) {
                    c = [];
                    this.usedNamesNamed.set(type, c);
                }

                c.push(replacement);

                return replacement;
            });

            let counter = 1;
            s = s.replace(/##gendigit##/g, (s) => {
                return (counter++).toString();
            });

            possibilities[k] = s;
        });

        return possibilities;
    }

    private findRule(name: string) {
        return this.ebnf.rules.find((s) => {
            return s.name === name;
        });
    }

    private processExpression(expression: ebnfParser.Expression, depth: number = 0): string[] {
        let ret = [''];
        let i = 0;

        switch (expression.type) {
            case 'choice':
                ret = [];
                expression.alternatives.forEach((a) => {
                    this.processExpression(a, depth + 1).forEach((v) => {
                        ret.push(v);
                    });
                });
                break;

            case 'sequence':
                expression.elements.forEach((e) => {
                    let elm = this.processExpression(e, depth + 1);
                    ret = this.mergeArray(ret, elm);
                });
                break;

            case 'optional':
                ret = this.mergeArray(ret, [
                    '',
                    ...this.processExpression(expression.expression, depth + 1)
                ]);
                break;

            case 'zero_or_more':
            case 'one_or_more':
                let p = [];
                if (expression.type === 'zero_or_more') {
                    p.push('');
                }

                if (expression.expression.type === 'rule_ref' && (expression.expression.name === 'DIGIT' || expression.expression.name === 'XDIGIT')) {
                    p.push(this.processExpression(expression.expression));
                    ret = p as string[];
                    break;
                }

                for (i = 0; i < this.maxCount; i++) {
                    let parts = [''];
                    for (let j = 0; j < this.maxCount && j <= i; j++) {
                        let elm = this.processExpression(expression.expression, depth + 1);
                        parts = this.mergeArray(parts, elm);
                    }
                    parts.forEach((v) => p.push(v));
                }
                ret = this.mergeArray(ret, p);
                break;

            case 'rule_ref':
                let ref = this.findRule(expression.name);
                if (!ref) {
                    console.error(`Rule '${expression.name}' not found`);
                    process.exit(1);
                }
                ret = this.processExpression(ref.expression, depth + 1);
                break;

            case 'literal':
                switch (expression.value) {
                    case '\\n':
                        ret[0] = '\n';
                        break;

                    case '\\t':
                        ret[0] = '    ';
                        break;

                    default:
                        ret[0] = expression.value;
                }
                break;

            case 'class':
                ret[0] = expression.rawText;
                break;

            case 'gentext':
                ret[0] = `##${expression.type};${expression.strType};${expression.useGenerated ? 't' : 'f'}##`;
                break;

            case 'gendigit':
                ret[0] = `##gendigit##`;
                break;
        }

        return ret;
    }

    private mergeArray(ret: string[], elm: string[]): string[] {
        let newParts: string[] = [];
        elm.forEach((e) => {
            ret.forEach((p) => {
                newParts.push(`${p}${e}`);
            });
        });

        return newParts;
    }

    private generateName(data: string = ''): string {
        if (!this.wordList) {
            let res = this.charList[this.sequence % 26];
            let seq = Math.floor(this.sequence / 26);

            while (seq > 0) {
                res += this.charList[seq % 26];
                seq = Math.floor(seq / 26);
            }

            this.sequence++;

            if (!checkReserved(res)) {
                return this.generateName(data);
            }

            return res;
        }

        let hash = md5(this.seed + this.sequence++ + data);

        let wordCount = (parseInt(hash[0], 16) % 4) + 1;
        let chunks = splitInChunks(hash, wordCount);

        let words: string[] = [];
        chunks.forEach((c) => {
            let num = hashToNumber(c);
            words.push(this.wordList[num % this.wordList.length]);
        });

        let name = camelCase(words);
        if (this.usedNames.has(name)) {
            return this.generateName(data + this.sequence++);
        }

        if (!name) {
            debugger;
        }

        this.usedNames.add(name);

        return name;
    }
}

function splitInChunks(str: string, len: number) {
    let parts = str.length / len;

    let pieces = [];
    for (let i = 0; i < len; i++) {
        pieces.push(str.substring(i * parts, (i + 1) * parts));
    }

    return pieces;
}

function camelCase(str: string | string[], firstUpperCase: boolean = false) {
    let parts;
    if (!(str instanceof Array)) {
        parts = str.split('_');
    } else {
        parts = str;
    }

    return parts.map((s, i) => {
        let f = s.charAt(0);

        if (i !== 0 || firstUpperCase) {
            f = f.toUpperCase();
        }

        return f + s.substring(1);
    }).join('');
}

function hashToNumber(hash: string) {
    if (hash.length >= 16) {
        hash = hash.substring(0, 16);
    }

    return parseInt(hash, 16);
}
