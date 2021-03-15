interface ParseOptions {
    startRule?: Function;
}

declare function parse(text: string, options?: ParseOptions): Grammar;

export interface Grammar {
    type: 'grammar';
    rules: Rule[];
    location: null;
}

export interface Rule {
    type: 'rule';
    name: string;
    expression: Expression;
    location: null;
}

export type Expression =
    ChoiceExpression |
    SequenceExpression |
    SubtractExpression |
    SuffixedExpression |
    RuleReferenceExpression |
    Literal |
    CharacterClass |
    GenText |
    GenDigit
    ;

export interface ChoiceExpression {
    type: 'choice';
    alternatives: Expression[];
    location: null;
}

export interface SequenceExpression {
    type: 'sequence';
    elements: Expression[];
    location: null;
}

export interface SubtractExpression {
    type: 'sequence';
    elements: Expression[];
    location: null;
}

export interface SuffixedExpression {
    type: 'optional' | 'zero_or_more' | 'one_or_more';
    expression: Expression;
    location: null;
}

export interface RuleReferenceExpression {
    type: 'rule_ref';
    name: string;
    location: null;
}

export interface Literal {
    type: 'literal';
    value: string;
    location: null;
}

export interface CharacterClass {
    type: 'class';
    inverted: boolean;
    rawText: string;
    location: null;
}

//CUSTOM
export interface GenText {
    type: 'gentext';
    strType: string;
    useGenerated: boolean;
}
export interface GenDigit {
    type: 'gendigit',
}


export {
    parse
};
