export type IID = number;

export type GIID = string;

export type LiteralKind =
    "StringLiteral" | "BooleanLiteral" | "NumericLiteral" | "FunctionLiteral" | "ObjectLiteral" |
    "UndefinedLiteral" | "NullLiteral" | "BigIntLiteral" | "RegExpLiteral" | "ArrayLiteral";

export interface SourceCodePointer {
  line: number;
  column: number;
}

export interface CodeSnippetLocation {
  start: SourceCodePointer;
  end: SourceCodePointer;
}

export interface SourceObject {
  name: string,
  loc: CodeSnippetLocation,
  range?: [number, number],
  internal?: boolean,
  eval?: string
}

export interface Jalangi {

  smap: { [key: number]: any };

  initParams?: any;

  sid: IID;

  getGlobalIID(iid: IID): GIID;

  iidToLocation(iid: IID | GIID): string;

  iidToSourceObject(iid: IID): SourceObject;

  analysis?: JalangiAnalysis;

  addAnalysis(analysis: JalangiAnalysis, filter?: (source: SourceObject) => boolean): void;

  enableAnalysis(): void;
  disableAnalysis(): void;

  smemory: {

    getShadowObject(
      obj: object,
      prop: string,
      isGetField: boolean
    ): { owner: object, isProperty: boolean };

    getShadowFrame(name: string): object;

    getIDFromShadowObjectOrFrame(obj: object): number | void;

    getActualObjectOrFunctionFromShadowObjectOrFrame(obj: object): any;

    getFrame(name: string): object;

    getShadowObjectOfObject(val: object): object | void;

  };

}

export interface JalangiAnalysis {

  invokeFunPre?(
      iid: IID,
      f: Function,
      base: object,
      args: any[],
      isConstructor: boolean,
      isMethod: boolean,
      functionIid: IID,
      functionSid: IID
  ): { f: Function, base: object, args: any[], skip: boolean } | void;

  invokeFun?(
      iid: IID,
      f: Function,
      base: any,
      args: any[],
      result: any,
      isConstructor: boolean,
      isMethod: boolean,
      functionIid: IID,
      functionSid: IID
  ): { result: any } | void; // note: not called if returned with exception!

  literal?(
      iid: IID,
      val: any,
      hasGetterSetter: boolean,
      kind: LiteralKind
  ): { result: any } | void;

  forObject?(
      iid: IID,
      isForIn: boolean
  ): { result: any } | void;

  declare?(
      iid: IID,
      name: string,
      val: any,
      isArgument: boolean,
      argumentIndex: number,
      isCatchParam: boolean
  ): { result: any } | void;

  getFieldPre?(
      iid: IID,
      base: any,
      offset: string | any,
      isComputed: boolean,
      isOpAssign: boolean,
      isMethodCall: boolean
  ): { base: any, offset: any, skip: boolean } | void;

  getField?(
      iid: IID,
      base: any,
      offset: string | any,
      val: any,
      isComputed: boolean,
      isOpAssign: boolean,
      isMethodCall: boolean
  ): { result: any } | void;

  putFieldPre?(
      iid: IID,
      base: any,
      offset: string | any,
      val: any,
      isComputed: boolean,
      isOpAssign: boolean
  ): { base: any, offset: any, val: any, skip: boolean } | void;

  putField?(
      iid: IID,
      base: any,
      offset: string | any,
      val: any,
      isComputed: boolean,
      isOpAssign: boolean
  ): { result: any } | void;

  read?(
      iid: IID,
      name: string,
      val: any,
      isGlobal: boolean,
      isScriptLocal: boolean,
  ): { result: any } | void;

  write?(
      iid: IID,
      name: string,
      val: any,
      lhs: any,
      isGlobal: any,
      isScriptLocal: any
  ): { result: any } | void;

  _return?(
      iid: IID,
      val: any
  ): { result: any } | void;

  _throw?(
      iid: IID,
      val: any
  ): { result: any } | void;

  _with?(
      iid: IID,
      val: any
  ): { result: any } | void;

  functionEnter?(
      iid: IID,
      f: Function,
      dis: any,
      args: any[]
  ): void;

  functionExit?(
      iid: IID,
      returnVal: any,
      wrappedExceptionVal: { exception: any } | undefined
  ): { returnVal: any, wrappedExceptionVal: any, isBacktrack: boolean } | void;

  binaryPre?(
      iid: IID,
      op: string,
      left: any,
      right: any,
      isOpAssign: boolean,
      isSwitchCaseComparison: boolean,
      isComputed: boolean
  ): { op: string, left: any, right: any, skip: boolean } | void;

  binary?(
      iid: IID,
      op: string,
      left: any,
      right: any,
      result: any,
      isOpAssign: boolean,
      isSwitchCaseComparison: boolean,
      isComputed: boolean
  ): { result: any } | void;

  unaryPre?(
      iid: IID,
      op: string,
      left: any
  ): { op: string, left: any, skip: boolean } | void;

  unary?(
      iid: IID,
      op: string,
      left: any,
      result: any
  ): { result: any } | void;

  conditional?(
      iid: IID,
      result: any
  ): { result: any } | void;

  instrumentCodePre?(
      iid: IID,
      code: any,
      isDirect: boolean
  ): { code: any, skip: boolean } | void;

  instrumentCode?(
      iid: IID,
      newCode: any,
      newAst: object,
      isDirect: boolean
  ): { result: any } | void;

  endExecution?(): void;

  runInstrumentedFunctionBody?(
      iid: IID,
      f: Function,
      functionIid: IID,
      functionSid: IID
  ): boolean;

  onReady?(cb: Function): void;

  newSource?(
      sourceInfo: { name: string, internal: boolean, eval?: string },
      source: string
  ): void;

  evalPre?(
      iid: IID,
      str: string
  ): void;

  evalPost?(
      iid: IID,
      str: string
  ): void;

  evalFunctionPre?(
      iid: IID,
      func: Function,
      receiver: object,
      args: any,
  ): void;

  evalFunctionPost?(
      iid: IID,
      func: Function,
      receiver: object,
      args: any,
      ret: any
  ): void;

  builtinEnter?(
      name: string,
      f: Function,
      dis: any,
      args: any,
  ): void;

  builtinExit?(
      name: string,
      f: Function,
      dis: any,
      args: any,
      returnVal: any,
      exceptionVal: any
  ): { returnVal: any } | void;

  asyncFunctionEnter?(
      iid: IID
  ): void;

  asyncFunctionExit?(
      iid: IID,
      returnVal: any,
      wrappedException: any
  ): void;

  awaitPre?(
      iid: IID,
      valAwaited: any
  ): void;

  awaitPost?(
      iid: IID,
      valAwaited: any,
      result: any,
      rejected: boolean
  ): void;

  startExpression?(
      iid : IID,
      type: String
  ): void;

  endExpression?(iid: IID): void;

  startStatement?(
      iid : IID,
      type : String
  ): void;

  endStatement?(
      iid : IID,
      type : String
  ): void;

  declarePre?(
      iid : IID,
      name : String,
      type : String,
      kind : String
  ): void;
}
