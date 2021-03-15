import * as fbR from './reflection';
import * as ts from 'typescript';
import * as fs from 'fs';
import {
    createAddition,
    createArray,
    createBasicArrowFunction,
    createBasicConditional,
    createBasicExportedFunction,
    createBasicMethod,
    createBasicProperty,
    createBasicStaticMethod,
    createBasicVariableAssignment,
    createBinary,
    createCall,
    createCaseClause,
    createClass,
    createConstVariable,
    createDefaultFor, createDefaultInvertedFor,
    createElementAccess,
    createEnum,
    createIf,
    createMultiplication,
    createNegation,
    createNestedCall,
    createNestedClassMemberAccess,
    createNestedPropertyAccess,
    createNew, createObjectLiteral,
    createOptionalParameter,
    createPrefix,
    createProperty,
    createQualifiedName,
    createReturn,
    createSwitch,
    createTypeReferenceNode, createUndefined,
    createVariable, ensureExpression,
    es,
    FunctionParameters,
    StrExpression,
    StrIdentifier
} from './codegenHelper';
import {
    FbGeneratorBase,
    camelCase,
    getName,
    getAttributeInField,
    getFbObjectUidField,
    typeStripArrayType,
    fieldStripArrayType,
    isArrayType,
    isLongType,
    isTypeScalar
} from './fbGeneratorBase';
import {factory} from 'typescript';

export interface Options {
    buildFbParser?: boolean;
    buildFbGenerator?: boolean;
    buildObjectifyFunc?: boolean;
}

interface FlatbufferAssignment {
    body: ts.Statement[];
    proxySupportedBody?: ts.Statement[];
    proxyNotSupportedBody?: ts.Statement[];
}

const objectLimitWithoutFile = 1000;

export class FbGenerator extends FbGeneratorBase {
    private targetFileName?: string;

    private readonly options: Options;

    constructor(schema: fbR.Schema, options: Options) {
        super(schema);
        this.options = options;
    }

    generate(targetFileName?: string) {
        this.targetFileName = targetFileName;

        return super.generate();
    }

    filenameRequired() {
        return this.schema.enums.length > objectLimitWithoutFile || this.schema.objects.length > objectLimitWithoutFile;
    }

    protected generateInt() {
        if (this.options.buildFbParser) {
            if (this.hasProxy) {
                this.createFeatureDetection();
            }

            this.createLookup();
        }

        if (this.targetFileName) {
            fs.writeFileSync(this.targetFileName, '');
        }

        if (this.schema.enums.length > objectLimitWithoutFile || this.schema.objects.length > objectLimitWithoutFile) {
            if (!this.targetFileName) {
                throw 'More than 10000 tables/structs/enums. Target filename required.';
            }

            fs.appendFileSync(this.targetFileName, this.printNodes());
        }

        if (this.schema.enums.length < objectLimitWithoutFile) {
            this.schema.enums.map((e) => {
                this.generateEnum(e);
            });
        } else {
            if (!this.targetFileName) {
                throw 'More than 10000 tables/structs/enums. Target filename required.';
            }

            this.nodes = [];

            for (let i = 0; i < this.schema.enums.length; i++) {
                this.generateEnum(this.schema.enums[i]);

                if (i !== 0 && i % 10000 === 0) {
                    fs.appendFileSync(this.targetFileName, this.printNodes());
                    this.nodes = [];
                }
            }

            this.nodes = [];
        }

        if (this.schema.objects.length < objectLimitWithoutFile) {
            this.schema.objects.forEach((v) => {
                this.generateClass(v);
            });
        } else {
            if (!this.targetFileName) {
                throw 'More than 10000 tables/structs/enums. Target filename required.';
            }

            this.nodes = [];

            for (let i = 0; i < this.schema.objects.length; i++) {
                this.generateClass(this.schema.objects[i]);

                if (i !== 0 && i % objectLimitWithoutFile === 0) {
                    fs.appendFileSync(this.targetFileName, this.printNodes());
                    this.nodes = [];
                }
            }

            this.nodes = [];
        }

        if (this.targetFileName) {
            fs.appendFileSync(this.targetFileName, this.printNodes());
            return false;
        }

        return true;
    }

    private createFeatureDetection() {
        // Check if es6 proxy is available
        this.nodes.push(createConstVariable(this.n.proxyFeature, factory.createTypeOfExpression(factory.createIdentifier('Proxy'))));
    }

    private createLookup() {
        let classClearCalls: ts.Statement[] = [];

        this.schema.objects.forEach((v) => {
            if (!getFbObjectUidField(v)) {
                return;
            }

            classClearCalls.push(es(createNestedCall(getName(v), this.n.clearLookupMemberFunc)));
        });

        if (classClearCalls.length) {
            //Create lookup clear function
            this.nodes.push(createBasicExportedFunction(
                this.n.clearLookupFunc,
                [],
                undefined,
                [
                    ...classClearCalls
                ]
            ));
        }
    }

    private generateEnum(e: fbR.Enum) {
        this.nodes.push(createEnum(
            getName(e),
            true,
            ...e.values.map((v): [StrIdentifier, StrExpression] => {
                if (!v.name) {
                    throw 'Enum value name required';
                }

                return [v.name, v.value];
            }))
        );
    }

    private generateClass(v: fbR.FbObject) {
        let cm: ts.ClassElement[] = [];

        cm.push(...this.createClassMembers(v));

        cm.push(this.createWithValuesConstructor(v));
        cm.push(this.createZeroConstructor(v));

        if (this.options.buildFbParser) {
            cm.push(this.createFlatbufferInitConstructor(v));
            cm.push(this.createFlatbufferConstructor(v));

            // cm.push(...this.createProxyMemberFunctions(v));
        }

        cm.push(this.createCopyFunction(v));

        if (this.options.buildObjectifyFunc) {
            cm.push(this.createObjectifyFunction(v));
            cm.push(this.createJsonBuilder());
        }

        if (this.options.buildFbGenerator) {
            cm.push(this.createFlatbufferBuild(v));
            cm.push(this.createFlatbufferBuilder());
        }

        if (this.options.buildFbParser && getFbObjectUidField(v)) {
            cm.push(this.createLookupClearFunction());
        }

        this.nodes.push(createClass(getName(v), true, cm));
    }

    private createClassMembers(v: fbR.FbObject) {
        let m: ts.PropertyDeclaration[] = [];

        if (this.options.buildFbParser) {
            // m.push(...[
            //     createProperty(
            //         this.n.byteBuffer,
            //         [],
            //         false,
            //         createTypeReferenceNode(
            //             createQualifiedName(this.n.fbLibImport, this.n.fbLibByteBuffer)
            //         )
            //     ),
            //     createProperty(
            //         this.n.byteBufferPos,
            //         [],
            //         false,
            //         ts.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
            //     )
            // ]);

            let uidField = getFbObjectUidField(v);
            if (uidField) {
                m.push(createProperty(
                    this.n.lookupMember,
                    [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.StaticKeyword],
                    false,
                    undefined,
                    createNew(
                        'Map',
                        [
                            this.convertType(uidField),
                            createTypeReferenceNode(getName(v)),
                        ]
                    )
                ));
            }
        }

        v.fields.sort((a, b) => {
            return a.id - b.id;
        }).forEach((f) => {
            m.push(createBasicProperty(
                camelCase(f.name!),
                false,
                this.convertType(f),
                this.convertTypeToDefaultValue(f)
            ));

            //Create helper variables for proxied class members
            if (this.options.buildFbParser && f.type!.baseType === fbR.BaseType.Vector && getAttributeInField(f, this.attributes.proxy)) {
                m.push(createProperty(
                    this.n.proxyVar(f.name!),
                    ts.SyntaxKind.PrivateKeyword,
                    true,
                    this.convertType(f)
                    // createTypeReferenceNode(
                    //     createQualifiedName(this.n.fbLibImport, this.n.fbLibArrayProxyHelper),
                    //     [
                    //         this.convertType(fieldStripArrayType(f))
                    //     ]
                    // )
                ));
            }
        });

        return m;
    }

    private createWithValuesConstructor(v: fbR.FbObject): ts.ClassElement {
        let params: FunctionParameters = [];
        let body: ts.Statement[] = [
            createVariable(this.n.instance, undefined, createNew(getName(v)))
        ];

        v.fields.forEach((f) => {
            params.push([f.name!, this.convertType(f)]);
            body.push(es(
                createBasicVariableAssignment(
                    createNestedPropertyAccess(this.n.instance, f.name!),
                    f.name!
                )
            ));
        });

        body.push(createReturn(this.n.instance));

        return createBasicStaticMethod(
            this.n.fromValues,
            params,
            undefined,
            body
        );
    }

    private createZeroConstructor(v: fbR.FbObject): ts.ClassElement {
        let args: ts.Expression[] = [];

        v.fields.forEach((f) => {
            args.push(this.convertTypeToDefaultValue(f));
        });

        let name = getName(v);

        return createBasicStaticMethod(
            this.n.fromZero,
            [],
            createTypeReferenceNode(name),
            createReturn(createNestedCall(name, [this.n.fromValues, args]))
        );
    }

    private createFlatbufferInitConstructor(v: fbR.FbObject): ts.ClassElement {
        let body: ts.Statement[] = [];
        let proxyNotSupportedBody: ts.Statement[] = [];
        let proxySupportedBody: ts.Statement[] = [];

        let name = getName(v.name!);

        const uidField = getFbObjectUidField(v);

        let type: ts.TypeNode = createTypeReferenceNode(name);

        if (uidField) {
            type = factory.createUnionTypeNode([
                type,
                factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)
            ]);
        }

        body.push(...[
            createVariable(this.n.instance, type),
            createIf(
                factory.createParenthesizedExpression(createBasicVariableAssignment(
                    this.n.instance,
                    createNestedCall(
                        createNestedPropertyAccess(this.n.byteBuffer, this.n.fbLibOffsetLookup),
                        ['get', this.n.byteBufferPos]
                    )
                )),
                createReturn(this.n.instance)
            ),
        ]);

        if (uidField) {
            body.push(...[
                ...this.createFlatbufferAccessors(uidField, v),
                ...this.createFlatbufferVariableAssignment(uidField, v, true).body,
                createIf(
                    factory.createParenthesizedExpression(createBasicVariableAssignment(
                        this.n.instance,
                        createNestedCall(
                            createNestedPropertyAccess(name, this.n.lookupMember),
                            ['get', uidField.name!]
                        )
                    )),
                    createReturn(this.n.instance)
                )
            ]);
        }

        body.push(...[
            es(createBasicVariableAssignment(this.n.instance, createNew(name))),
            es(createNestedCall(
                createNestedPropertyAccess(this.n.byteBuffer, this.n.fbLibOffsetLookup),
                ['set', [this.n.byteBufferPos, this.n.instance]]
            )),
        ]);

        if (uidField) {
            body.push(es(createNestedCall(
                createNestedPropertyAccess(name, this.n.lookupMember),
                ['set', [uidField.name!, this.n.instance]]
            )));
        }

        // body.push(...[
        //     es(createBasicVariableAssignment(
        //         this.createInstanceVarNestedPropertyAccess(this.n.byteBuffer),
        //         this.n.byteBuffer
        //     )),
        //     es(createBasicVariableAssignment(
        //         this.createInstanceVarNestedPropertyAccess(this.n.byteBufferPos),
        //         this.n.byteBufferPos
        //     )),
        // ]);

        v.fields.forEach((f) => {
            if (f === uidField) {
                body.push(es(createBasicVariableAssignment(
                    this.createInstanceVarNestedPropertyAccess(f.name!),
                    f.name!
                )));

                return;
            }

            let proxyField = !!getAttributeInField(f, this.attributes.proxy);

            body.push(...this.createFlatbufferAccessors(f, v));

            let ass: FlatbufferAssignment;
            if (f.type!.baseType === fbR.BaseType.Vector && proxyField) {
                ass = this.createFlatbufferProxyListAssignment(f, v);
            } else if (proxyField) {
                ass = this.createFlatbufferProxyAssignment(f, v);
            } else {
                ass = this.createFlatbufferVariableAssignment(f, v);
            }

            if (ass) {
                body.push(...ass.body);

                if (ass.proxyNotSupportedBody) {
                    proxyNotSupportedBody.push(...ass.proxyNotSupportedBody);
                }

                if (ass.proxySupportedBody) {
                    proxySupportedBody.push(...ass.proxySupportedBody);
                }
            }
        });

        if (proxySupportedBody.length && proxySupportedBody.length) {
            body.push(createIf(
                this.n.proxyFeature,
                proxySupportedBody,
                proxyNotSupportedBody
            ));
        } else if (proxySupportedBody.length && !proxySupportedBody.length) {
            body.push(createIf(
                this.n.proxyFeature,
                proxySupportedBody
            ));
        } else if (proxyNotSupportedBody.length && !proxySupportedBody.length) {
            body.push(createIf(
                createNegation(this.n.proxyFeature),
                proxyNotSupportedBody
            ));
        }

        return createBasicStaticMethod(
            this.n.fbInit,
            [
                [this.n.byteBuffer, createTypeReferenceNode(createQualifiedName(this.n.fbLibImport, this.n.fbLibByteBuffer))],
                [this.n.byteBufferPos, factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)]
            ],
            createTypeReferenceNode(factory.createIdentifier(name)),
            [
                ...body,
                createReturn(this.n.instance)
            ]
        );
    }

    private createFlatbufferConstructor(v: fbR.FbObject): ts.ClassElement {
        let name = getName(v);

        return createBasicStaticMethod(
            this.n.fromFb,
            [
                ['__buffer', 'Uint8Array'],
                createOptionalParameter(this.n.continueLookup, createTypeReferenceNode(createQualifiedName(this.n.fbLibImport, this.n.fbLibTable)))
            ],
            createTypeReferenceNode(factory.createIdentifier(name)),
            [
                createVariable(
                    this.n.byteBuffer,
                    undefined,
                    createNew(
                        createNestedPropertyAccess(this.n.fbLibImport, this.n.fbLibByteBuffer),
                        undefined,
                        ['__buffer']
                    )
                ),
                createIf(
                    this.n.continueLookup,
                    es(createNestedCall(
                        this.n.byteBuffer,
                        ['copyLookup', createNestedPropertyAccess(
                            this.n.continueLookup,
                            this.n.byteBuffer
                        )]
                    ))
                ),
                createReturn(
                    createNestedCall(name,
                        [this.n.fbInit, [
                            this.n.byteBuffer,
                            createBinary(
                                createNestedCall(this.n.byteBuffer, [
                                    'readInt32',
                                    createNestedCall(this.n.byteBuffer, 'position')
                                ]),
                                ts.SyntaxKind.PlusToken,
                                createNestedCall(this.n.byteBuffer, 'position')
                            )
                        ]]
                    )
                )
            ]
        );
    }

    private createFlatbufferBuild(v: fbR.FbObject) {
        let body: ts.Statement[] = [
            createVariable(
                this.n.instOffset,
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
            ),
            createIf(
                factory.createParenthesizedExpression(createBasicVariableAssignment(
                    this.n.instOffset,
                    createNestedCall(
                        this.n.builder,
                        [this.n.fbLibRegisterObject, factory.createThis()]
                    )
                )),
                createReturn(this.n.instOffset)
            ),
        ];

        v.fields.forEach((f, k) => {
            if (f.type!.baseType !== fbR.BaseType.Vector) {
                return;
            }

            let t = fieldStripArrayType(f);

            let ass = this.createFlatbufferBuilderValue(t, this.n.counter1);
            let objAss;

            body.push(createVariable(
                this.n.offsetVar(f.name!),
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                0
            ));

            let createVecBody: ts.Statement[] = [];

            if (t.type!.baseType === fbR.BaseType.Obj || t.type!.baseType === fbR.BaseType.Union || t.type!.baseType === fbR.BaseType.String) {
                createVecBody.push(...[
                    createVariable(
                        f.name!,
                        factory.createArrayTypeNode(factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)),
                        createArray()
                    ),

                    createDefaultFor(
                        this.n.counter1,
                        0,
                        ts.SyntaxKind.LessThanToken,
                        createNestedClassMemberAccess(f.name!, 'length'),
                        es(createBasicVariableAssignment(
                            createElementAccess(f.name!, this.n.counter1),
                            ass,
                        ))
                    ),
                ]);

                ass = createElementAccess(f.name!, this.n.counter1);
                objAss = createElementAccess(createNestedClassMemberAccess(f.name!), this.n.counter1);
            }

            createVecBody.push(...[
                es(createNestedCall(
                    this.n.builder,
                    ['startVector', [
                        this.typeInlineSize(t.type!).toString(),
                        createNestedClassMemberAccess(f.name!, 'length'),
                        this.alignmentOfType(f.type!).toString()
                    ]]
                )),

                createDefaultInvertedFor(
                    this.n.counter1,
                    createBinary(
                        createNestedClassMemberAccess(f.name!, 'length'),
                        ts.SyntaxKind.MinusToken,
                        1
                    ),
                    ts.SyntaxKind.GreaterThanEqualsToken,
                    0,
                    es(this.createFlatbufferBuilderAssignment(t, k, ass, objAss))
                ),

                es(createBasicVariableAssignment(
                    this.n.offsetVar(f.name!),
                    createNestedCall(this.n.builder, 'endVector'),
                )),
            ]);

            body.push(createIf(
                this.convertTypeToTypeCheck(f, createNestedClassMemberAccess(f.name!)),
                createVecBody
            ));
        });

        v.fields.filter((f) => {
            return f.type!.baseType === fbR.BaseType.Obj || f.type!.baseType === fbR.BaseType.Union || f.type!.baseType === fbR.BaseType.String;
        }).forEach((f) => {
            body.push(...[
                createVariable(
                    this.n.offsetVar(f.name!),
                    factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                    0
                ),
                createIf(
                    this.convertTypeToTypeCheck(f, createNestedClassMemberAccess(f.name!)),
                    es(createBasicVariableAssignment(
                        this.n.offsetVar(f.name!),
                        this.createFlatbufferBuilderValue(f)
                    ))
                )
            ]);
        });

        body.push(...[
            es(createNestedCall(
                this.n.builder,
                ['startObject', [
                    v.fields.length.toString(),
                    factory.createThis()
                ]]
            ))
        ]);

        v.fields.forEach((f, k) => {
            let fieldAss;
            let fieldCheckVar: StrExpression = createNestedClassMemberAccess(f.name!);

            if (f.type!.baseType === fbR.BaseType.Obj || f.type!.baseType === fbR.BaseType.Union || f.type!.baseType === fbR.BaseType.Vector || f.type!.baseType === fbR.BaseType.String) {
                fieldAss = es(this.createFlatbufferBuilderAssignment(
                    f,
                    k,
                    this.n.offsetVar(f.name!),
                    createNestedClassMemberAccess(f.name!)
                ));

                fieldCheckVar = this.n.offsetVar(f.name!);

            } else if (f.type!.baseType === fbR.BaseType.Array) {
                let t = fieldStripArrayType(f);

                let ass = this.createFlatbufferBuilderValue(t);

                fieldAss = createDefaultFor(
                    this.n.counter1,
                    0,
                    ts.SyntaxKind.LessThanToken,
                    createNestedClassMemberAccess(f.name!, 'length'),
                    es(this.createFlatbufferBuilderAssignment(t, k, ass))
                );

                fieldCheckVar = this.n.offsetVar(f.name!);
            } else {
                fieldAss = es(this.createFlatbufferBuilderAssignment(f, k, this.createFlatbufferBuilderValue(f)));
            }

            body.push(createIf(
                fieldCheckVar,
                fieldAss
            ));
        });

        body.push(createReturn(createNestedCall(
            this.n.builder,
            'endObject'
        )));

        return createBasicMethod(
            this.n.fbBuild,
            [[this.n.builder, createTypeReferenceNode(createQualifiedName(this.n.fbLibImport, 'Builder'))]],
            undefined,
            body
        );
    }

    private createFlatbufferBuilder() {
        return createBasicMethod(
            this.n.buildFb,
            [],
            undefined,
            [
                createVariable(
                    this.n.builder,
                    undefined,
                    createNew(createNestedPropertyAccess(this.n.fbLibImport, this.n.fbLibBuilder))
                ),

                es(createNestedCall(
                    this.n.builder,
                    ['finish', createNestedCall(
                        factory.createThis(),
                        [this.n.fbBuild, this.n.builder]
                    )]
                )),

                createReturn(createNestedCall(this.n.builder, 'bytes'))
            ]
        );
    }

    private createFlatbufferAccessors(f: fbR.Field, c: fbR.FbObject) {
        let body = [];

        if (!c.isStruct) {
            body.push(createVariable(
                this.n.offsetVar(f.name!),
                undefined,
                createNestedCall(
                    this.n.byteBuffer,
                    ['__offset', [
                        this.n.byteBufferPos,
                        f.offset.toString()
                    ]]
                )
            ));
        }

        return body;
    }

    private createFlatbufferVariableAssignment(f: fbR.Field, c: fbR.FbObject, newVariable: boolean = false, unionArrayIndex?: StrExpression): FlatbufferAssignment {
        let body: ts.Statement[] = [];

        let fStripVector = f.copy();
        fStripVector.type = typeStripArrayType(f.type!.copy());

        switch (f.type!.baseType) {
            case fbR.BaseType.Vector:
                let getterFunc: StrExpression = this.createFlatbufferGetter(
                    fStripVector,
                    c,
                    false,
                    createAddition(
                        this.n.vecPosVar(f.name!),
                        createMultiplication(this.n.counter1, this.typeInlineSize(f.type!))
                    )
                );

                let forBody: ts.Statement[] = [];
                if (f.type!.element === fbR.BaseType.Union) {
                    forBody = this.createFlatbufferVariableAssignment(fieldStripArrayType(f), c, true, this.n.counter1).body;
                    getterFunc = f.name!;
                }

                body.push(createIf(
                    this.n.offsetVar(f.name!),
                    [
                        this.createVectorLengthGetter(f),
                        createVariable(
                            this.n.vecPosVar(f.name!),
                            undefined,
                            createNestedCall(this.n.byteBuffer, ['__vector', createAddition(this.n.byteBufferPos, this.n.offsetVar(f.name!))])
                        ),
                        es(createBasicVariableAssignment(
                            this.createInstanceVarNestedPropertyAccess(f.name!),
                            createNew(
                                'Array',
                                [this.convertType(fieldStripArrayType(f))],
                                [this.n.lengthVar(f.name!)]
                            )
                        )),
                        createDefaultFor(
                            this.n.counter1,
                            0,
                            ts.SyntaxKind.LessThanToken,
                            this.n.lengthVar(f.name!),
                            [
                                ...forBody,
                                es(createBasicVariableAssignment(
                                    createElementAccess(
                                        this.createInstanceVarNestedPropertyAccess(f.name!),
                                        this.n.counter1
                                    ),
                                    getterFunc
                                ))

                            ]
                        )
                    ], [
                        es(createBasicVariableAssignment(
                            this.createInstanceVarNestedPropertyAccess(f.name!),
                            this.convertTypeToDefaultValue(f)
                        ))
                    ]));
                break;

            case fbR.BaseType.Array:
                if (f.type!.fixedLength > 20) {
                    body = [
                        createVariable(
                            f.name!,
                            undefined,
                            createNew(
                                'Array',
                                [this.convertType(fieldStripArrayType(f))],
                                [f.type!.fixedLength.toString()]
                            ),
                        ),
                        createDefaultFor(
                            this.n.counter1,
                            0,
                            ts.SyntaxKind.LessThanToken,
                            f.type!.fixedLength.toString(),
                            [
                                es(createBasicVariableAssignment(
                                    createElementAccess(f.name!, this.n.counter1),
                                    this.createFlatbufferGetter(f, c, true, undefined, this.n.counter1)
                                ))
                            ]
                        )
                    ];
                } else {
                    let elements: StrExpression[] = [];

                    for (let i = 0; i < f.type!.fixedLength; i++) {
                        elements.push(this.createFlatbufferGetter(f, c, true, undefined, i));
                    }

                    body = [
                        createVariable(
                            f.name!,
                            undefined,
                            createArray(elements, true)
                        ),
                    ];
                }
                break;

            case fbR.BaseType.Union:
                let en = this.schema.enums[f.type!.index];

                let cases: ts.CaseOrDefaultClause[] = [];
                en.values.forEach((v) => {
                    if (v.value === 0) {
                        return;
                    }

                    cases.push(createCaseClause(
                        createNestedPropertyAccess(getName(en), v.name!),
                        [
                            es(createBasicVariableAssignment(
                                f.name!,
                                createNestedCall(
                                    v.name!,
                                    [this.n.fbInit, [this.n.byteBuffer, this.n.offsetVar(f.name!)]]
                                ))
                            ),
                            factory.createBreakStatement()
                        ]
                    ));
                });

                cases.push(factory.createDefaultClause([
                    es(createBasicVariableAssignment(f.name!, factory.createNull()))
                ]));

                let unionTypeAccess: ts.Expression = this.createInstanceVarNestedPropertyAccess(this.n.unionTypeVar(f.name!));
                if (unionArrayIndex) {
                    unionTypeAccess = createElementAccess(unionTypeAccess, unionArrayIndex);
                }

                body = [
                    createVariable(f.name!, this.convertType(f)),
                    createSwitch(unionTypeAccess, cases)
                ];
                break;

            default:
                let getter = this.createFlatbufferGetter(f, c, true);

                if (newVariable) {
                    body = [
                        createVariable(f.name!, undefined, getter)
                    ];
                } else {
                    body = [
                        es(createBasicVariableAssignment(
                            this.createInstanceVarNestedPropertyAccess(f.name!),
                            getter
                        ))
                    ];
                }

        }

        return {
            body: body
        };
    }

    private createFlatbufferProxyAssignment(f: fbR.Field, c: fbR.FbObject): FlatbufferAssignment {
        let makeWriteable = es(createNestedCall(
            'Object',
            ['defineProperty', [
                this.n.instance,
                factory.createStringLiteral(f.name!),
                factory.createObjectLiteralExpression([
                    factory.createPropertyAssignment('writable', factory.createTrue()),
                    factory.createPropertyAssignment('enumerable', factory.createTrue()),
                    factory.createPropertyAssignment('configurable', factory.createTrue()),
                ])
            ]]
        ));

        return {
            body: [
                createIf(
                    this.n.offsetVar(f.name!),
                    es(createNestedCall(
                        'Object',
                        ['defineProperty', [
                            this.n.instance,
                            factory.createStringLiteral(f.name!),
                            factory.createObjectLiteralExpression([
                                factory.createPropertyAssignment('get', createBasicArrowFunction(
                                    [],
                                    undefined,
                                    [
                                        makeWriteable,

                                        es(createBasicVariableAssignment(
                                            this.createInstanceVarNestedPropertyAccess(f.name!),
                                            this.createFlatbufferGetter(f, c, false)
                                        )),
                                        createReturn(this.createInstanceVarNestedPropertyAccess(f.name!))
                                    ]
                                )),
                                factory.createPropertyAssignment('set', createBasicArrowFunction(
                                    ['v'],
                                    undefined,
                                    [
                                        makeWriteable,

                                        es(createBasicVariableAssignment(
                                            this.createInstanceVarNestedPropertyAccess(f.name!),
                                            'v'
                                        ))
                                    ]
                                ))
                            ], true)
                        ]]
                    )),
                    es(createBasicVariableAssignment(
                        this.createInstanceVarNestedPropertyAccess(f.name!),
                        factory.createNull()
                    ))
                )
            ]
        };
    }

    private createFlatbufferProxyListAssignment(f: fbR.Field, c: fbR.FbObject): FlatbufferAssignment {
        let ass = this.createFlatbufferVariableAssignment(f, c);

        let fStripVector = f.copy();
        fStripVector.type = typeStripArrayType(f.type!.copy());

        const proxy = getAttributeInField(f, this.attributes.proxy);
        let preDecodeCount = proxy ? parseInt(proxy) : 0;
        if (preDecodeCount === 0) {
            preDecodeCount = 2;
        }

        return {
            body: [],
            proxySupportedBody: [
                createIf(
                    this.n.offsetVar(f.name!),
                    [
                        this.createVectorLengthGetter(f),
                        es(createBasicVariableAssignment(
                            this.createInstanceVarNestedPropertyAccess(this.n.proxyVar(f.name!)),
                            createCall(
                                createNestedPropertyAccess(this.n.fbLibImport, 'createProxyArray'),
                                [
                                    this.convertType(fStripVector)
                                ],
                                [
                                    this.n.byteBuffer,
                                    createAddition(this.n.byteBufferPos, this.n.offsetVar(f.name!)),
                                    this.n.lengthVar(f.name!),
                                    this.typeInlineSize(f.type!).toString(),
                                    preDecodeCount.toString(),
                                    createBasicArrowFunction(
                                        [
                                            [
                                                this.n.byteBuffer,
                                                createTypeReferenceNode(createQualifiedName(this.n.fbLibImport, this.n.fbLibByteBuffer))
                                            ],
                                            [
                                                '__offset',
                                                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
                                            ]
                                        ],
                                        undefined,
                                        [
                                            createReturn(this.createFlatbufferGetter(fStripVector, c, false, '__offset'))
                                        ]
                                    )
                                ]
                            )
                        )),
                        es(this.createProxy(f, preDecodeCount))
                    ]
                )
            ],
            proxyNotSupportedBody: ass.body
        };
    }

    private createFlatbufferGetter(f: fbR.Field, c: fbR.FbObject, conditional: boolean, customOffset?: StrExpression, key?: StrExpression | number) {
        let funcCall: ts.Expression = factory.createIdentifier('NOPE');
        let typeField = f;

        if (isTypeScalar(f.type!) || f.type!.baseType === fbR.BaseType.String) {
            let call = this.n.fbLibReadType(f);
            let prefix: ts.PrefixUnaryOperator | ts.PrefixUnaryOperator[] | null = null;
            let args: StrExpression[] = [];

            if (c.isStruct) {
                let a: StrExpression = this.n.byteBufferPos;

                if (f.offset) {
                    a = createAddition(this.n.byteBufferPos, f.offset.toString());
                }

                args.push(a);
            } else {
                args.push(createAddition(
                    this.n.byteBufferPos,
                    this.n.offsetVar(f.name!)
                ));
            }

            switch (f.type!.baseType) {
                case fbR.BaseType.String:
                    call = '__string';
                    break;

                case fbR.BaseType.Bool:
                    prefix = [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.ExclamationToken];
                    break;
            }

            if (customOffset) {
                args = [customOffset];
            }

            funcCall = createNestedCall(
                this.n.byteBuffer,
                [call, args]
            );

            if (prefix) {
                funcCall = createPrefix(prefix, funcCall);
            }
        } else {
            let args: StrExpression;

            switch (f.type!.baseType) {
                case fbR.BaseType.Obj:
                    let obj = this.schema.objects[f.type!.index];

                    if (c.isStruct) {
                        args = this.n.byteBufferPos;

                        if (f.offset) {
                            args = createAddition(this.n.byteBufferPos, f.offset.toString());
                        }

                        if (customOffset) {
                            args = customOffset;
                        }

                    } else {
                        let offset: StrExpression = createAddition(this.n.byteBufferPos, this.n.offsetVar(f.name!));

                        if (customOffset) {
                            offset = customOffset;
                        }

                        args = createNestedCall(this.n.byteBuffer, ['__indirect', offset]);
                    }

                    funcCall = createNestedCall(
                        getName(obj),
                        [this.n.fbInit, [this.n.byteBuffer, args]]
                    );

                    break;

                case fbR.BaseType.Array:
                    typeField = fieldStripArrayType(f);

                    args = this.n.byteBufferPos;

                    if (f.offset) {
                        args = createAddition(this.n.byteBufferPos, f.offset.toString());
                    }

                    let arrayOffset;
                    let typeSize = this.typeInlineSize(typeField.type!);
                    if (typeof key === 'number') {
                        arrayOffset = (key * typeSize).toString();
                    } else if (key) {
                        arrayOffset = createMultiplication(key, typeSize.toString());
                    }

                    if (arrayOffset && arrayOffset !== '0') {
                        args = createAddition(args, arrayOffset);
                    }

                    funcCall = this.createFlatbufferGetter(typeField, c, false, args);
                    break;

                default:
                    debugger;
            }
        }

        if (!c.isStruct && conditional) {
            return createBasicConditional(
                this.n.offsetVar(f.name!),
                funcCall,
                this.convertTypeToDefaultValue(typeField)
            );
        }

        return funcCall;
    }

    private createVectorLengthGetter(f: fbR.Field) {
        return createVariable(
            this.n.lengthVar(f.name!),
            undefined,
            createNestedCall(
                this.n.byteBuffer,
                ['__vector_len', [
                    createAddition(this.n.byteBufferPos, this.n.offsetVar(f.name!))
                ]]
            )
        );
    }

    private createFlatbufferBuilderValue(f: fbR.Field, key?: StrIdentifier): ts.Expression {
        let prefix: ts.PrefixUnaryOperator | null = null;

        // noinspection FallThroughInSwitchStatementJS
        switch (f.type!.baseType) {
            case fbR.BaseType.Bool:
                prefix = ts.SyntaxKind.PlusToken;

            case fbR.BaseType.None:
            case fbR.BaseType.UType:
            case fbR.BaseType.Byte:
            case fbR.BaseType.UByte:
            case fbR.BaseType.Short:
            case fbR.BaseType.UShort:
            case fbR.BaseType.Int:
            case fbR.BaseType.UInt:
            case fbR.BaseType.Long:
            case fbR.BaseType.ULong:
            case fbR.BaseType.Float:
            case fbR.BaseType.Double:
                let val: ts.Expression = createNestedClassMemberAccess(f.name!);

                if (key) {
                    val = createElementAccess(val, key);
                }

                if (prefix) {
                    val = createPrefix(prefix, val);
                }

                return val;

            case fbR.BaseType.String:
                let strAccess: ts.Expression = createNestedClassMemberAccess(f.name!);
                if (key) {
                    strAccess = createElementAccess(strAccess, key);
                }

                return createNestedCall(
                    this.n.builder,
                    ['createString', strAccess]
                );

            case fbR.BaseType.Union:
            case fbR.BaseType.Obj:
                let startObjectAccess: ts.Expression = createNestedClassMemberAccess(f.name!);
                if (key) {
                    startObjectAccess = createElementAccess(startObjectAccess, key);
                }

                return createNestedCall(startObjectAccess, [this.n.fbBuild, this.n.builder]);

        }

        throw 'Invalid type';
    }

    private createFlatbufferBuilderAssignment(f: fbR.Field, idx: number, val: StrExpression, objVal?: StrExpression): ts.Expression {
        let prefix;
        let call: ts.Expression;

        let defaultVal: StrExpression = f.defaultInteger.toString();

        if (isLongType(f.type!.baseType) && !!getAttributeInField(f, this.attributes.numberAsLong)) {
            defaultVal = createNestedPropertyAccess(this.n.fbLibImport, this.n.fbLibLong, 'ZERO');
        }

        let args = [val];

        if (objVal) {
            args.push(objVal);
        }

        // noinspection FallThroughInSwitchStatementJS
        switch (f.type!.baseType) {
            case fbR.BaseType.Bool:
                prefix = ts.SyntaxKind.PlusToken;

            case fbR.BaseType.None:
            case fbR.BaseType.UType:
            case fbR.BaseType.Byte:
            case fbR.BaseType.UByte:
            case fbR.BaseType.Short:
            case fbR.BaseType.UShort:
            case fbR.BaseType.Int:
            case fbR.BaseType.UInt:
            case fbR.BaseType.Long:
            case fbR.BaseType.ULong:
            case fbR.BaseType.Float:
            case fbR.BaseType.Double:
                let arrFunc = this.convertTypeBuffer(f);

                if (f.type!.element === fbR.BaseType.Vector) {
                    return createNestedCall(
                        this.n.builder,
                        [`add${arrFunc}`, [
                            val
                        ]]
                    );
                }

                return createNestedCall(
                    this.n.builder,
                    [`addField${arrFunc}`, [
                        factory.createNumericLiteral(idx.toString()),
                        val,
                        defaultVal
                    ]]
                );

            case fbR.BaseType.String:
                if (f.type!.element === fbR.BaseType.Vector) {
                    return createNestedCall(
                        this.n.builder,
                        ['addOffsetString', val]
                    );
                }

                call = createNestedCall(
                    this.n.builder,
                    ['addFieldVector', [
                        factory.createNumericLiteral(idx.toString()),
                        val,
                        defaultVal
                    ]]
                );
                break;

            case fbR.BaseType.Union:
            case fbR.BaseType.Obj:
                if (f.type!.element === fbR.BaseType.Vector) {
                    return createNestedCall(
                        this.n.builder,
                        ['addOffsetObj', args]
                    );
                }

                call = createNestedCall(
                    this.n.builder,
                    ['addFieldOffset', [
                        factory.createNumericLiteral(idx.toString()),
                        ...args,
                        f.defaultInteger.toString()
                    ]]
                );
                break;

            case fbR.BaseType.Vector:
                call = createNestedCall(
                    this.n.builder,
                    ['addFieldVector', [
                        factory.createNumericLiteral(idx.toString()),
                        val,
                        f.defaultInteger.toString()
                    ]]
                );
                break;

            case fbR.BaseType.Array:
                return this.createFlatbufferBuilderAssignment(fieldStripArrayType(f), idx, val, objVal);

            default:
                throw 'WHAT';
        }

        return call;
    }

    private createLookupClearFunction() {
        return createBasicStaticMethod(
            this.n.clearLookupMemberFunc,
            [],
            undefined,
            es(createNestedCall(
                createNestedPropertyAccess(factory.createThis(), this.n.lookupMember),
                'clear'
            ))
        );
    }

    private createCopyFunction(v: fbR.FbObject) {
        let body: ts.Statement[] = [];
        let deepCopyIfBody: ts.Statement[] = [];
        let deepCopyIfElseBody: ts.Statement[] = [];

        body.push(createVariable(this.n.instance, undefined, createNew(getName(v))));

        v.fields.forEach((f) => {
            let deepCopyAble = isArrayType(f.type!.baseType) || this.containsClassOrArrayType(f.type!);

            let proxy = this.options.buildFbParser && !!getAttributeInField(f, this.attributes.proxy);

            switch (f.type!.baseType) {
                case fbR.BaseType.None:
                case fbR.BaseType.UType:
                case fbR.BaseType.Bool:
                case fbR.BaseType.Byte:
                case fbR.BaseType.UByte:
                case fbR.BaseType.Short:
                case fbR.BaseType.UShort:
                case fbR.BaseType.Int:
                case fbR.BaseType.UInt:
                case fbR.BaseType.Long:
                case fbR.BaseType.ULong:
                case fbR.BaseType.Float:
                case fbR.BaseType.Double:
                case fbR.BaseType.String:
                case fbR.BaseType.Union:
                    body.push(es(createBasicVariableAssignment(
                        this.createInstanceVarNestedPropertyAccess(f.name!),
                        createNestedClassMemberAccess(f.name!)
                    )));
                    break;

                case fbR.BaseType.Vector:
                case fbR.BaseType.Array:
                    let basicSliceAssignment = es(createBasicVariableAssignment(
                        this.createInstanceVarNestedPropertyAccess(f.name!),
                        createNestedCall(createNestedClassMemberAccess(f.name!), 'slice')
                    ));

                    if (proxy) {
                        deepCopyIfBody.push(createIf(
                            this.n.proxyFeature,
                            [
                                es(createBasicVariableAssignment(
                                    this.createInstanceVarNestedPropertyAccess(this.n.proxyVar(f.name!)),
                                    createBasicConditional(
                                        createNestedClassMemberAccess(this.n.proxyVar(f.name!)),
                                        createNestedCall(createNestedClassMemberAccess(this.n.proxyVar(f.name!)), 'slice'),
                                        createUndefined()
                                    )
                                ))
                            ]
                        ));
                    }

                    deepCopyIfBody.push(basicSliceAssignment);


                    deepCopyIfElseBody.push(es(createBasicVariableAssignment(
                        this.createInstanceVarNestedPropertyAccess(f.name!),
                        createNestedClassMemberAccess(f.name!)
                        ))
                    );

                    if (proxy) {
                        deepCopyIfElseBody.push(createIf(
                            this.n.proxyFeature,
                            es(createBasicVariableAssignment(
                                this.createInstanceVarNestedPropertyAccess(this.n.proxyVar(f.name!)),
                                createNestedClassMemberAccess(this.n.proxyVar(f.name!))
                            ))
                        ));
                    }

                    break;

                case fbR.BaseType.Obj:
                    let getObjCopy = (deepCopy: boolean) => {
                        return es(createBasicVariableAssignment(
                            this.createInstanceVarNestedPropertyAccess(f.name!),
                            createBasicConditional(
                                createNestedClassMemberAccess(f.name!),
                                createNestedCall(
                                    createNestedClassMemberAccess(f.name!),
                                    deepCopy ? [this.n.copy, factory.createTrue()] : this.n.copy
                                ),
                                factory.createNull()
                            )
                        ));
                    };

                    if (deepCopyAble) {
                        deepCopyIfBody.push(getObjCopy(true));
                        deepCopyIfElseBody.push(getObjCopy(false));
                    } else {
                        body.push(getObjCopy(false));
                    }
                    break;
            }
        });

        let parameters: FunctionParameters = [];

        if (deepCopyIfBody.length) {
            parameters = [[
                this.n.deepCopy,
                factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
                factory.createFalse()
            ]];

            body.push(createIf(
                this.n.deepCopy,
                deepCopyIfBody,
                deepCopyIfElseBody
            ));
        }

        body.push(createReturn(this.n.instance));

        return createBasicMethod(
            this.n.copy,
            parameters,
            createTypeReferenceNode(getName(v)),
            body
        );
    }

    private createObjectifyFunction(v: fbR.FbObject) {
        let body: ts.Statement[] = [];

        let properties: ts.PropertyAssignment[] = [];

        v.fields.forEach((f) => {
            let ifBody: ts.Statement[] = [];
            let access: ts.Expression = createNestedClassMemberAccess(f.name!);
            let ifAccess = access;

            if (f.type!.baseType === fbR.BaseType.Vector && f.type!.element === fbR.BaseType.Obj) {
                body.push(...[
                    createVariable(
                        f.name!,
                        undefined,
                        createNew(
                            'Array',
                            undefined,
                            [createBasicConditional(
                                access,
                                createNestedPropertyAccess(access, 'length'),
                                factory.createNumericLiteral('0')
                            )]
                        )
                    ),

                    createVariable(
                        `_${f.name}`,
                        undefined,
                        access
                    )
                ]);
            }

            if (f.type!.baseType === fbR.BaseType.Obj) {
                access = createBasicConditional(
                    access,
                    createNestedCall(
                        access,
                        this.n.objectify
                    ),
                    factory.createNull()
                );
            } else if (f.type!.baseType === fbR.BaseType.Vector && !!getAttributeInField(f, 'proxy')) {
                access = ensureExpression(`_${f.name}`);
            }

            if (f.type!.baseType === fbR.BaseType.Vector && f.type!.element === fbR.BaseType.Obj) {
                ifBody.push(createDefaultFor(
                    this.n.counter1,
                    0,
                    ts.SyntaxKind.LessThanToken,
                    createNestedPropertyAccess(access, 'length'),
                    es(createBasicVariableAssignment(
                        createElementAccess(f.name!, this.n.counter1),
                        createNestedCall(
                            createElementAccess(access, this.n.counter1),
                            this.n.objectify
                        )
                    ))
                ));

                access = ensureExpression(f.name!);
            }

            if (ifBody.length) {
                body.push(createIf(
                    ifAccess,
                    ifBody
                ));
            }

            properties.push(factory.createPropertyAssignment(
                f.name!,
                access
            ));
        });

        body.push(createReturn(createObjectLiteral(properties)));

        return createBasicMethod(
            this.n.objectify,
            [],
            undefined,
            body
        );
    }

    private createJsonBuilder() {
        return createBasicMethod(
            this.n.buildJson,
            [],
            undefined,
            createReturn(createNestedCall('JSON', [
                'stringify',
                createNestedCall(
                    factory.createThis(),
                    this.n.objectify
                )
            ]))
        );
    }

    private createProxy(f: fbR.Field, preDecodeCount: number) {
        return createBasicVariableAssignment(
            this.createInstanceVarNestedPropertyAccess(f.name!),
            createNestedCall(
                this.n.fbLibImport, [
                    'newProxy',
                    [
                        this.createInstanceVarNestedPropertyAccess(this.n.proxyVar(f.name!)),
                        preDecodeCount.toString()
                    ]
                ]
            )
        );
    }
}
