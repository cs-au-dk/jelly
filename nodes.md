# Babel AST node types

https://babeljs.io/docs/en/babel-types
https://github.com/babel/babel/blob/master/packages/babel-parser/ast/spec.md

### Program

- [X] File (ignore)
- [X] Program

### Declarations (excluding classes)

- [X] VariableDeclaration
  - [X] VariableDeclarator
- [X] FunctionDeclaration

### Statements

- [X] ReturnStatement
- [X] ThrowStatement
- [ ] CatchClause
- [X] DoWhileStatement (ignore)
- [X] EmptyStatement (ignore)
- [X] ContinueStatement (ignore)
- [X] ExpressionStatement (ignore)
- [X] SwitchStatement (ignore)
  - [X] SwitchCase (ignore)
- [X] TryStatement (ignore)
- [X] WhileStatement (ignore)
- [X] BlockStatement (ignore)
- [X] BreakStatement (ignore)
- [X] IfStatement (ignore)
- [X] LabeledStatement (ignore)
- [X] ForStatement (ignore)
- [X] ForInStatement (ignore)
- [X] ForOfStatement
- [X] WithStatement (warn)

### Literals

- [X] StringLiteral
- [X] BooleanLiteral (ignore)
- [X] NullLiteral (ignore)
- [X] NumericLiteral (ignore)
- [X] BigIntLiteral (ignore)
- [X] RegExpLiteral (ignore)

### Expressions (excluding literals, classes, etc.)

- [X] Identifier
- [X] PrivateName
- [X] ArrowFunctionExpression
- [X] AssignmentExpression
- [X] CallExpression
- [X] ConditionalExpression
- [X] FunctionExpression
- [X] LogicalExpression
- [X] MemberExpression
- [X] NewExpression
- [X] SequenceExpression
- [X] ObjectExpression (ignore)
  - [X] ObjectMethod
  - [X] ObjectProperty
- [X] ArrayExpression (ignore)
- [X] UnaryExpression (ignore)
- [X] BinaryExpression (ignore)
- [X] UpdateExpression (ignore)
- [X] ParenthesizedExpression (ignore)
- [X] TemplateLiteral (ignore)
- [X] TemplateElement (ignore)
- [X] OptionalCallExpression
- [X] OptionalMemberExpression
- [X] ThisExpression
- [X] YieldExpression
- [X] TaggedTemplateExpression
- [X] AwaitExpression

### Classes

- [X] ClassDeclaration
- [X] ClassExpression
- [X] ClassBody
  - [X] ClassMethod
  - [X] ClassPrivateMethod
  - [X] ClassPrivateProperty
  - [X] ClassProperty
  - [X] StaticBlock
- [ ] Super (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/super)

### Patterns, rest, spread

- [X] AssignmentPattern
- [X] ObjectPattern
- [X] ArrayPattern
- [X] RestElement


- [ ] SpreadElement (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax)


### Module/import/export

- [X] ImportDeclaration
  - [X] ImportSpecifier
  - [X] ImportDefaultSpecifier
  - [X] ImportNamespaceSpecifier
  - [ ] ImportAttribute (https://github.com/tc39/proposal-import-assertions)
- [X] Import
- [X] ExportNamedDeclaration
  - [X] ExportSpecifier
  - [ ] ExportNamespaceSpecifier (`export * as x from "m"`, like `import * as x from "m"; export {x}`)
  - [X] ExportDefaultSpecifier
- [X] ExportDefaultDeclaration
- [X] ExportAllDeclaration

### Other

- [X] Directive (ignore)
  - [X] DirectiveLiteral (ignore)
- [X] Noop (ignore)
- [X] DebuggerStatement (ignore)
- [X] Placeholder (ignore)
- [X] InterpreterDirective (ignore)
- [X] V8IntrinsicIdentifier (see the 'v8intrinsic' Babel plugin)

### JSX

https://github.com/facebook/jsx/blob/main/AST.md

- [X] JSXElement
- [X] JSXIdentifier
- [X] JSXMemberExpression
- [X] JSXFragment (ignore)
- [X] JSXNamespacedName (ignore)
- [X] JSXOpeningFragment (ignore)
- [X] JSXClosingFragment (ignore)
- [X] JSXExpressionContainer (ignore)
- [X] JSXEmptyExpression (ignore)
- [X] JSXSpreadChild (ignore)
- [X] JSXOpeningElement (ignore)
- [X] JSXClosingElement (ignore)
- [X] JSXAttribute (ignore)
- [X] JSXSpreadAttribute (ignore)
- [X] JSXText (ignore)

# Language extensions (currently all ignored)

### Module blocks

https://github.com/tc39/proposal-js-module-blocks

- ModuleExpression

### Grouped accessors and auto-accessors

https://github.com/tc39/proposal-grouped-and-auto-accessors

- ClassAccessorProperty

### Decimal

https://github.com/tc39/proposal-decimal

- DecimalLiteral

### Generator function.sent meta property

https://babeljs.io/docs/en/babel-plugin-proposal-function-sent

- MetaProperty

### Pipeline operator

https://github.com/tc39/proposal-pipeline-operator
https://babeljs.io/docs/en/babel-plugin-proposal-pipeline-operator

- PipelineBareFunction
- PipelineTopicExpression
- PipelinePrimaryTopicReference
- TopicReference

### Decorators

https://github.com/tc39/proposal-decorators
https://babeljs.io/docs/en/babel-plugin-proposal-decorators

- Decorator

### Records and tuples

https://github.com/tc39/proposal-record-tuple
https://babeljs.io/docs/en/babel-plugin-proposal-record-and-tuple

- RecordExpression 
- TupleExpression

### Do expressions

https://github.com/tc39/proposal-do-expressions
https://babeljs.io/docs/en/babel-plugin-proposal-do-expressions

- DoExpression

### Partial application

https://github.com/tc39/proposal-partial-application
https://babeljs.io/docs/en/babel-plugin-proposal-partial-application

- ArgumentPlaceholder

### Bind expressions

https://github.com/tc39/proposal-bind-operator
https://babeljs.io/docs/en/babel-plugin-proposal-function-bind

- BindExpression

### TypeScript

https://babeljs.io/docs/en/babel-types#typescript
https://babeljs.io/docs/en/babel-plugin-transform-typescript

- TS*

### Flow

https://babeljs.io/docs/en/babel-types#flow
https://babeljs.io/docs/en/babel-plugin-transform-flow-strip-types

- AnyTypeAnnotation
- ArrayTypeAnnotation
- BooleanLiteralTypeAnnotation
- BooleanTypeAnnotation
- ClassImplements
- DeclareClass
- DeclareExportAllDeclaration
- DeclareExportDeclaration
- DeclareFunction
- DeclareInterface
- DeclareModule
- DeclareModuleExport
- DeclareOpaqueType
- DeclareTypeAlias
- DeclareVariable
- DeclaredPredicate
- EmptyTypeAnnotation
- EnumBooleanBody
- EnumBooleanMember
- EnumDeclaration
- EnumDefaultedMember
- EnumNumberBody
- EnumNumberMember
- EnumStringBody
- EnumStringMember
- EnumSymbolBody
- ExistsTypeAnnotation
- FunctionTypeAnnotation
- FunctionTypeParam
- GenericTypeAnnotation
- IndexedAccessType
- InferredPredicate
- InterfaceDeclaration
- InterfaceExtends
- InterfaceTypeAnnotation
- IntersectionTypeAnnotation
- MixedTypeAnnotation
- NullLiteralTypeAnnotation
- NullableTypeAnnotation
- NumberLiteralTypeAnnotation
- NumberTypeAnnotation
- ObjectTypeAnnotation
- ObjectTypeCallProperty
- ObjectTypeIndexer
- ObjectTypeInternalSlot
- ObjectTypeProperty
- ObjectTypeSpreadProperty
- OpaqueType
- OptionalIndexedAccessType
- QualifiedTypeIdentifier
- StringLiteralTypeAnnotation
- StringTypeAnnotation
- SymbolTypeAnnotation
- TupleTypeAnnotation
- ThisTypeAnnotation
- TypeAlias
- TypeAnnotation
- TypeCastExpression
- TypeParameter
- TypeParameterDeclaration
- TypeParameterInstantiation
- TypeofTypeAnnotation
- UnionTypeAnnotation
- Variance
- VoidTypeAnnotation
