import * as ts from 'typescript';
import {factory} from 'typescript';

export type StrIdentifier = string | ts.Identifier;
export type StrExpression = number | StrIdentifier | ts.Expression;
export type FunctionIdentifierWithArgs = [StrIdentifier, StrExpression | StrExpression[]];
export type Modifier = UnpackToken<ts.Modifier>;
export type StatementOrArray = ts.Statement | ts.Statement[];

export type FunctionParameters = (FunctionParameter | ts.ParameterDeclaration)[];
export type FunctionParameter =
    string
    | [string, undefined]
    | [string, string | ts.TypeNode]
    | [string, string | ts.TypeNode, StrExpression];

type UnpackToken<T> = T extends ts.Token<infer U> ? U : never;

export function ensureIdentifier(v: StrIdentifier): ts.Identifier {
    if (typeof v === 'string') {
        return factory.createIdentifier(v);
    }

    return v;
}

export function ensureExpression(v: StrExpression): ts.Expression {
    if (typeof v === 'string') {
        return ensureIdentifier(v);
    } else if (typeof v === 'number') {
        return factory.createNumericLiteral(v.toString());
    }

    return v;
}

export function ensureStatementArray(body: StatementOrArray) {
    if (!(body instanceof Array)) {
        body = [body];
    }

    let statements: ts.Statement[] = [];

    body.forEach((v) => {
        if ('_expressionBrand' in v) {
            statements.push(factory.createExpressionStatement(v));
            return;
        }

        statements.push(v);
    });

    return statements;
}

export function createImportEverythingAs(file: string, alias: string) {
    return factory.createImportDeclaration(
        undefined,
        undefined,
        factory.createImportClause(
            false,
            undefined,
            factory.createNamespaceImport(ensureIdentifier(alias))
        ),
        factory.createStringLiteral(file)
    );
}

export function createImport(file: string, namedImports: Set<string> | string[] | string) {
    function specifier(name: string) {
        return factory.createImportSpecifier(
            undefined,
            factory.createIdentifier(name)
        );
    }

    let imports = [];

    if (typeof namedImports === 'string') {
        imports.push(specifier(namedImports));
    } else if (namedImports instanceof Array) {
        for (let i = 0; i < namedImports.length; i++) {
            imports.push(specifier(namedImports[i]));
        }
    } else {
        namedImports.forEach((i: string) => {
            imports.push(specifier(i));
        });
    }

    return factory.createImportDeclaration(
        undefined,
        undefined,
        factory.createImportClause(
            false,
            undefined,
            factory.createNamedImports(imports)
        ),
        factory.createStringLiteral(file)
    );
}

export function createExportImport(file: string, namedExports: Set<string> | string[] | string) {
    function specifier(name: string) {
        return factory.createExportSpecifier(
            undefined,
            factory.createIdentifier(name)
        );
    }

    let exports = [];

    if (typeof namedExports === 'string') {
        exports.push(specifier(namedExports));
    } else if (namedExports instanceof Array) {
        for (let i = 0; i < namedExports.length; i++) {
            exports.push(specifier(namedExports[i]));
        }
    } else {
        namedExports.forEach((i) => {
            exports.push(specifier(i));
        });
    }

    return factory.createExportDeclaration(
        undefined,
        undefined,
        false,
        factory.createNamedExports(exports),
        factory.createStringLiteral(file)
    );
}

export function createNestedPropertyAccess(expression: StrExpression, identifier1: StrIdentifier, ...identifier: StrIdentifier[]): ts.PropertyAccessExpression {
    let prev = factory.createPropertyAccessExpression(
        ensureExpression(expression),
        identifier1,
    );

    for (let i = 0; i < identifier.length; i++) {
        let iden = identifier[i];
        identifier[i] = ensureIdentifier(iden);
    }

    for (let i = 0; i < identifier.length; i++) {
        prev = factory.createPropertyAccessExpression(
            prev,
            identifier[i],
        );
    }

    return prev;
}

export function createNestedClassMemberAccess(identifier1: StrIdentifier, ...identifier: StrIdentifier[]) {
    return createNestedPropertyAccess(factory.createThis(), identifier1, ...identifier);
}

type NestedCallIdentifiers = StrIdentifier | FunctionIdentifierWithArgs;

export function createNestedCall(identifier1: StrExpression, identifier2: NestedCallIdentifiers, ...identifier: NestedCallIdentifiers[]): ts.CallExpression {
    identifier = [identifier2, ...identifier];

    let iden: ts.Identifier[] = [];
    let args: ts.Expression[][] = [];
    for (let i = 0; i < identifier.length; i++) {
        let t = identifier[i];
        let identifierToAdd: StrIdentifier;
        let argsToAdd: StrExpression[] = [];

        if (t instanceof Array) {
            if (t.length < 2) {
                throw 'Missing argument';
            }

            identifierToAdd = t[0];

            if (t[1] instanceof Array) {
                argsToAdd = t[1];
            } else {
                argsToAdd = t.slice(1) as StrExpression[];
            }
        } else {
            identifierToAdd = t;
        }

        let argsToAddExpr: ts.Expression[] = [];
        for (let j = 0; j < argsToAdd.length; j++) {
            argsToAddExpr[j] = ensureExpression(argsToAdd[j]);
        }

        argsToAdd = argsToAdd.filter((a) => {
            return !!a;
        });

        iden.push(ensureIdentifier(identifierToAdd));
        args.push(argsToAddExpr);
    }

    let prev: ts.Expression = ensureExpression(identifier1);

    for (let i = 0; i < iden.length; i++) {
        prev = factory.createCallExpression(
            factory.createPropertyAccessExpression(
                prev,
                iden[i],
            ),
            undefined,
            args[i]
        );
    }

    return prev as ts.CallExpression;
}

export function createCall(expression: StrExpression, typeArgs: ts.TypeNode[] | undefined, args: StrExpression[]) {
    return factory.createCallExpression(
        ensureExpression(expression),
        typeArgs,
        args.map(ensureExpression)
    );

}

export function createBasicCall(expression: StrExpression, args: StrExpression[]) {
    return createCall(
        expression,
        undefined,
        args
    );
}


export function createBasicClassMemberAssignment(variable: string, expr: StrExpression): ts.Statement {
    return factory.createExpressionStatement(
        createBasicVariableAssignment(
            createNestedPropertyAccess(
                factory.createThis(),
                variable
            ),
            expr
        )
    );
}

export function createBinary(left: StrExpression, operator: Parameters<typeof factory.createBinaryExpression>[1], right: StrExpression) {
    return factory.createBinaryExpression(
        ensureExpression(left),
        operator,
        ensureExpression(right)
    );
}

export function createAnd(expression1: StrExpression, expression2: StrExpression, ...expression: StrExpression[]): ts.Expression {
    let prev = ensureExpression(expression1);

    expression = [
        expression2,
        ...expression
    ];

    for (let i = 0; i < expression.length; i++) {
        prev = createBinary(
            prev,
            ts.SyntaxKind.AmpersandAmpersandToken,
            expression[i]
        );
    }

    return prev;
}

export function createNeq(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.ExclamationEqualsToken, right);
}

export function createNeqeq(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.ExclamationEqualsEqualsToken, right);
}

export function createEqeq(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.EqualsEqualsToken, right);
}

export function createEqeqeq(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.EqualsEqualsEqualsToken, right);
}

export function createBasicVariableAssignment(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.EqualsToken, right);
}

export function createAddition(left: StrExpression, right: StrExpression) {
    return createBinary(left, ts.SyntaxKind.PlusToken, right);
}

export function createMultiplication(left: StrExpression, right: StrExpression) {
    if (right === 1) {
        return left;
    }

    return createBinary(left, ts.SyntaxKind.AsteriskToken, right);
}

function _createVariable(name: StrIdentifier, type?: ts.TypeNode, initializer?: StrExpression, flags?: ts.NodeFlags): ts.VariableStatement {
    return factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
            [
                factory.createVariableDeclaration(
                    ensureIdentifier(name),
                    undefined,
                    type,
                    initializer !== undefined ? ensureExpression(initializer) : undefined
                )
            ],
            flags
        )
    );
}

export function createVariable(name: StrIdentifier, type?: ts.TypeNode, initializer?: StrExpression): ts.VariableStatement {
    return _createVariable(name, type, initializer, ts.NodeFlags.Let);
}

export function createConstVariable(name: StrIdentifier, initializer?: StrExpression): ts.VariableStatement {
    return _createVariable(name, undefined, initializer, ts.NodeFlags.Const);
}

export function createArray(elements: StrExpression[] = [], multiline: boolean = false): ts.ArrayLiteralExpression {
    return factory.createArrayLiteralExpression(
        elements.map(ensureExpression),
        multiline
    );
}

export function createEmptyArrayClass(initialiser: StrExpression) {
    return createNew(
        'Array',
        undefined,
        [ensureExpression(initialiser)]
    );
}

export function createFor(counter: StrIdentifier, counterInit: StrExpression, condition: ts.Expression, incrementor: ts.Expression, body: StatementOrArray) {
    return factory.createForStatement(
        createVariable(counter, undefined, ensureExpression(counterInit)).declarationList,
        condition,
        incrementor,
        createBlock(body)
    );
}

export function createDefaultFor(counter: StrIdentifier, counterInit: StrExpression, compareToken: ts.BinaryOperator | ts.BinaryOperatorToken, length: StrExpression, body: StatementOrArray) {
    return createFor(
        counter,
        counterInit,
        createBinary(counter, compareToken, ensureExpression(length)),
        createPostfix(counter, ts.SyntaxKind.PlusPlusToken),
        body
    );
}

export function createDefaultInvertedFor(counter: StrIdentifier, counterInit: StrExpression, compareToken: ts.BinaryOperator | ts.BinaryOperatorToken, length: StrExpression, body: StatementOrArray) {
    return createFor(
        counter,
        counterInit,
        createBinary(counter, compareToken, ensureExpression(length)),
        createPostfix(counter, ts.SyntaxKind.MinusMinusToken),
        body
    );
}

export function createFunctionParameters(parameters: FunctionParameters) {
    let params: ts.ParameterDeclaration[] = [];

    for (let i = 0; i < parameters.length; i++) {
        let param = parameters[i];

        if (typeof param === 'string') {
            param = [param, undefined];
        }

        if (param instanceof Array) {
            let type = param[1];
            let initialiser = param[2];

            if (typeof type === 'string') {
                type = factory.createTypeReferenceNode(factory.createIdentifier(type), undefined);
            }

            param = factory.createParameterDeclaration(
                undefined,
                undefined,
                undefined,
                factory.createIdentifier(param[0]),
                undefined,
                type,
                initialiser ? ensureExpression(initialiser) : undefined
            );
        }

        params.push(param);
    }

    return params;
}

export function createOptionalParameter(name: StrIdentifier, type?: string | ts.TypeNode, initialiser?: StrExpression) {
    if (typeof type === 'string') {
        type = factory.createTypeReferenceNode(factory.createIdentifier(type), undefined);
    }

    return factory.createParameterDeclaration(
        undefined,
        undefined,
        undefined,
        ensureIdentifier(name),
        factory.createToken(ts.SyntaxKind.QuestionToken),
        type,
        initialiser ? ensureExpression(initialiser) : undefined
    );
}

export function createModifiers(modifiers: Modifier | Modifier[]): ts.Modifier[] | undefined {
    if (!modifiers) {
        return undefined;
    }

    if (!(modifiers instanceof Array)) {
        modifiers = [modifiers];
    }

    return modifiers.map((v) => {
        return factory.createModifier(v);
    });
}

export function createBlock(body: StatementOrArray): ts.Block {
    return factory.createBlock(
        ensureStatementArray(body),
        true
    );
}

export function createFunction(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, modifiers: Modifier | Modifier[], body: StatementOrArray) {
    return factory.createFunctionDeclaration(
        undefined,
        createModifiers(modifiers),
        undefined,
        ensureIdentifier(name),
        undefined,
        createFunctionParameters(parameters),
        returnType,
        createBlock(body)
    );
}

export function createMethod(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, modifiers: Modifier | Modifier[], body: StatementOrArray) {
    return factory.createMethodDeclaration(
        undefined,
        createModifiers(modifiers),
        undefined,
        ensureIdentifier(name),
        undefined,
        undefined,
        createFunctionParameters(parameters),
        returnType,
        createBlock(body)
    );
}

export function createBasicFunction(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, body: StatementOrArray) {
    return createFunction(
        name,
        parameters,
        returnType,
        [],
        body
    );
}

export function createBasicMethod(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, body: StatementOrArray) {
    return createMethod(
        name,
        parameters,
        returnType,
        [],
        body
    );
}

export function createBasicExportedFunction(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, body: StatementOrArray) {
    return createFunction(
        name,
        parameters,
        returnType,
        ts.SyntaxKind.ExportKeyword,
        body
    );
}

export function createBasicStaticMethod(name: StrIdentifier, parameters: FunctionParameters, returnType: ts.TypeNode | undefined, body: StatementOrArray) {
    return createMethod(
        name,
        parameters,
        returnType,
        ts.SyntaxKind.StaticKeyword,
        body
    );
}

export function createBasicArrowFunction(parameters: FunctionParameters, returnType: ts.TypeNode | undefined, body: StatementOrArray) {
    return factory.createArrowFunction(
        undefined,
        undefined,
        createFunctionParameters(parameters),
        returnType,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        createBlock(body)
    );
}

export function createBasicConstructor(parameters: FunctionParameters, body: StatementOrArray) {
    return factory.createConstructorDeclaration(
        undefined,
        undefined,
        createFunctionParameters(parameters),
        createBlock(body)
    );
}

export function createPostfix(operand: StrExpression, token: ts.PostfixUnaryOperator | ts.PostfixUnaryOperator[]) {
    let prev = ensureExpression(operand);

    if (!(token instanceof Array)) {
        token = [token];
    }

    for (let i = 0; i < token.length; i++) {
        prev = factory.createPostfixUnaryExpression(prev, token[i]);
    }

    return prev;
}

export function createPrefix(token: ts.PrefixUnaryOperator | ts.PrefixUnaryOperator[], operand: StrExpression) {
    let prev = ensureExpression(operand);

    if (!(token instanceof Array)) {
        token = [token];
    }

    for (let i = 0; i < token.length; i++) {
        prev = factory.createPrefixUnaryExpression(token[i], prev);
    }

    return prev;
}

type PostOrPrefixStr = 'postfix' | 'prefix';

export function postOrPrefix(operand: StrExpression, token: ts.PostfixUnaryOperator | ts.PrefixUnaryOperator, type: PostOrPrefixStr) {
    switch (type) {
        case 'postfix':
            return createPostfix(
                operand,
                <ts.PostfixUnaryOperator>token
            );

        case 'prefix':
            return createPrefix(
                <ts.PrefixUnaryOperator>token,
                operand
            );
    }
}

export function createIncrement(operand: StrExpression, type: PostOrPrefixStr = 'postfix') {
    return postOrPrefix(operand, ts.SyntaxKind.PlusPlusToken, type);
}

export function createDecrement(operand: StrExpression, type: PostOrPrefixStr = 'postfix') {
    return postOrPrefix(operand, ts.SyntaxKind.MinusMinusToken, type);
}

export function createNegation(operand: StrExpression) {
    return createPrefix(ts.SyntaxKind.ExclamationToken, operand);
}

export function createNew(expression: StrExpression, typeArguments?: ts.TypeNode[], argumentsArray?: StrExpression[]) {
    return factory.createNewExpression(
        ensureExpression(expression),
        typeArguments || [],
        argumentsArray ? argumentsArray.map(ensureExpression) : []
    );
}

export function createReturn(expression?: StrExpression) {
    return factory.createReturnStatement(expression ? ensureExpression(expression) : undefined);
}

export function createTypeReferenceNode(name: StrIdentifier | ts.QualifiedName, typeArguments?: ts.TypeNode[]) {
    if (typeof name === 'string') {
        name = factory.createIdentifier(name);
    }

    return factory.createTypeReferenceNode(name, typeArguments);
}

export function createQualifiedName(left: StrIdentifier | ts.QualifiedName, right: StrIdentifier) {
    if (typeof left === 'string') {
        left = factory.createIdentifier(left);
    }

    return factory.createQualifiedName(left, right);
}

export function createProperty(name: StrIdentifier, modifiers: Modifier | Modifier[], optional: boolean, type?: ts.TypeNode, initializer?: ts.Expression) {
    return factory.createPropertyDeclaration(
        undefined,
        createModifiers(modifiers),
        ensureIdentifier(name),
        optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
        type,
        initializer
    );
}

export function createStaticProperty(name: StrIdentifier, optional: boolean, type?: ts.TypeNode, initializer?: ts.Expression) {
    return createProperty(
        name,
        ts.SyntaxKind.StaticKeyword,
        optional,
        type,
        initializer
    );
}

export function createBasicProperty(name: StrIdentifier, optional: boolean, type?: ts.TypeNode, initializer?: ts.Expression) {
    return createProperty(
        name,
        [],
        optional,
        type,
        initializer
    );
}

export function createReadonlyProperty(name: StrIdentifier, optional: boolean, type?: ts.TypeNode, initializer?: ts.Expression) {
    return createProperty(
        name,
        ts.SyntaxKind.ReadonlyKeyword,
        optional,
        type,
        initializer
    );
}

export function createIf(condition: StrExpression, thenBlock: StatementOrArray, elseBlock?: StatementOrArray) {
    return factory.createIfStatement(
        ensureExpression(condition),
        createBlock(thenBlock),
        elseBlock && createBlock(elseBlock)
    );
}

export function createLeadingComment(node: ts.Node, text: string) {
    return ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.SingleLineCommentTrivia,
        text,
        true
    );
}

export function es(expression: ts.Expression) {
    return factory.createExpressionStatement(expression);
}

export function createTypeOf(expression: StrExpression) {
    return factory.createTypeOfExpression(ensureExpression(expression));
}

export function createElementAccess(expression: StrExpression, index: StrExpression) {
    return factory.createElementAccessExpression(
        ensureExpression(expression),
        ensureExpression(index)
    );
}

export function createFunctionTypeNode(parameters: FunctionParameters, returnType?: ts.TypeNode) {
    if (!returnType) {
        returnType = factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
    }

    return factory.createFunctionTypeNode(
        undefined,
        createFunctionParameters(parameters),
        returnType
    );
}

export function createNamespace(name: StrIdentifier, _export: boolean, block: StatementOrArray) {
    return factory.createModuleDeclaration(
        undefined,
        _export ? createModifiers(ts.SyntaxKind.ExportKeyword) : [],
        ensureIdentifier(name),
        factory.createModuleBlock(ensureStatementArray(block)),
        ts.NodeFlags.Namespace
    );
}

export function createEnum(name: StrIdentifier, _export: boolean, ...members: (StrIdentifier | [StrIdentifier, undefined] | [StrIdentifier, StrExpression])[]) {
    return factory.createEnumDeclaration(
        undefined,
        _export ? createModifiers(ts.SyntaxKind.ExportKeyword) : [],
        ensureIdentifier(name),
        members.map((v) => {
            if (!(v instanceof Array)) {
                v = [v, undefined];
            }

            return factory.createEnumMember(
                ensureIdentifier(v[0]),
                v[1] ? ensureExpression(v[1]) : undefined
            );
        })
    );
}

export function createClass(name: StrIdentifier, _export: boolean, members: ts.ClassElement[] = []) {
    return factory.createClassDeclaration(
        undefined,
        _export ? createModifiers(ts.SyntaxKind.ExportKeyword) : [],
        name,
        undefined,
        undefined,
        members
    );
}

export function createUndefined() {
    return factory.createIdentifier('undefined');
}

export function createBasicConditional(condition: StrExpression, whenTrue: StrExpression, whenFalse: StrExpression) {
    return factory.createConditionalExpression(
        ensureExpression(condition),
        factory.createToken(ts.SyntaxKind.QuestionToken),
        ensureExpression(whenTrue),
        factory.createToken(ts.SyntaxKind.ColonToken),
        ensureExpression(whenFalse)
    );
}

export function createVariableOrAssignment(name: StrIdentifier, expression: StrExpression, varOrAss: boolean) {
    if (varOrAss) {
        return createVariable(name, undefined, expression);
    }

    return es(createBasicVariableAssignment(name, expression));
}

export function createSwitch(expression: StrExpression, caseBlock: ts.CaseOrDefaultClause[]) {
    return factory.createSwitchStatement(
        ensureExpression(expression),
        factory.createCaseBlock(caseBlock)
    );
}

export function createCaseClause(expression: StrExpression, statements: ts.Statement[]) {
    return factory.createCaseClause(
        ensureExpression(expression),
        statements
    );
}

export function createBasicFunctionTypeNode(parameters: FunctionParameters, returnType: ts.TypeNode) {
    return factory.createFunctionTypeNode(
        undefined,
        createFunctionParameters(parameters),
        returnType
    );
}

export function createObjectLiteral(properties: ts.ObjectLiteralElementLike[]) {
    return factory.createObjectLiteralExpression(
        properties,
        true
    );
}

export function createNullType() {
    return factory.createLiteralTypeNode(factory.createNull());
}
