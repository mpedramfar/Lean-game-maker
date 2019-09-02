export const leanSyntax = {
    // Set defaultToken to invalid to see what you do not tokenize yet
    // defaultToken: 'invalid',

    keywords: [
      'def', 'definition', 'lemma', 'theorem', 'example', 'axiom', 'constant', 'constants',
      'class', 'instance', 'structure', 'inductive', 'variable', 'variables',
      'universe', 'universes',
      'attribute', 'namespace', 'section', 'noncomputable',
      'meta', 'mutual',
      'do', 'have', 'let', 'assume', 'suffices', 'show', 'from',
      'local', 'notation', 'open', 'export',
      'by', 'begin', 'end',
      'λ', '∀', 'Π', '∃', 'Σ',
      'if', 'this', 'break', 'protected', 'private', 'else',
      '#print', '#check', '#eval', '#reduce', '#help', '#exit', '#unify', '#compile',
      'set_option', 'import', 'prelude',
    ],

    typeKeywords: [
      'Sort', 'Prop', 'Type',
    ],

    operators: [
      '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
      '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
      '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
      '%=', '<<=', '>>=', '>>>=', '→',
    ],

    // we include these common regular expressions
    symbols:  /[=><!~?:&|+\-*\/\^%]+/,

    // C# style strings
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    // The main tokenizer for our languages
    tokenizer: {
      root: [
        // attributes
        [/#\[[^\]]+\]/, { token: 'annotation' }],

        [/sorry/, {token: 'invalid'}],
        [/noncomputable theory/, {token: 'keyword'}],

        // identifiers and keywords
        [/[#A-Za-z_][\w'$]*/, { cases: { '@typeKeywords': 'keyword',
                                    '@keywords': 'keyword',
                                    '@default': 'identifier' } }],

        // whitespace
        { include: '@whitespace' },

        // delimiters and operators
        [/[{}()\[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, '@brackets'],
        [/@symbols/, { cases: { '@operators': 'operator',
                                '@default'  : '' } } ],

        // numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/\d+/, 'number'],

        // delimiter: after number because of .\d floats
        [/[;,.]/, 'delimiter'],

        // strings
        [/"([^"\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
        [/"/,  { token: 'string.quote', bracket: '@open', next: '@string' } ],

        // characters
        [/'[^\\']'/, 'string'],
        [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
        [/'/, 'string.invalid'],
      ],

      comment: [
        [/[^-]+/, 'comment' ],
        [/\/-/,    'comment', '@push' ],    // nested comment
        [/-\//,    'comment', '@pop'  ],
        [/[-*]/,   'comment' ],
      ],

      string: [
        [/[^\\"]+/,  'string'],
        [/@escapes/, 'string.escape'],
        [/\\./,      'string.escape.invalid'],
        [/"/,        { token: 'string.quote', bracket: '@close', next: '@pop' } ],
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\-/,       'comment', '@comment' ],
        [/--.*$/,    'comment'],
      ],
    },
};
