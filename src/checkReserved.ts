const reservedNames = [
    'any',
    'arguments',
    'as',
    'async',
    'await',
    'boolean',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'constructor',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'eval',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'infinity',
    'instanceof',
    'interface',
    'let',
    'module',
    'namespace',
    'nan',
    'new',
    'null',
    'number',
    'of',
    'package',
    'private',
    'protected',
    'public',
    'require',
    'return',
    'set',
    'static',
    'string',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
    'yield'
];

const reservedCaseWords = [
    'enum',
];

const globalReservedWords = [

];

const globalReservedCaseWords = [
    'type',
    'symbol',
];

export function checkReserved(str: string) {
    if (reservedCaseWords.includes(str)) {
        return false;
    }

    return !reservedNames.includes(str.toLowerCase());
}


