import {NodePath, PluginObj} from '@babel/core';
import {TemplateBuilder} from '@babel/template';
import {isTSExternalModuleReference, TSExportAssignment, TSImportEqualsDeclaration} from '@babel/types';

/**
 * Replaces TypeScript "export =" and "import =" syntax.
 * See https://babeljs.io/docs/en/babel-plugin-transform-typescript/#caveats
 * and https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require
 */
export function replaceTypeScriptImportExportAssignments({ template }: {template: TemplateBuilder<TSExportAssignment>}): PluginObj {
    const moduleExportsDeclaration = template("module.exports = ASSIGNMENT;");
    const moduleImportsDeclaration = template("var ID = require(MODULE);");
    return {
        visitor: {
            TSExportAssignment(path: NodePath<TSExportAssignment>) {
                path.replaceWith(moduleExportsDeclaration({
                    ASSIGNMENT: path.node.expression
                }));
            },
            TSImportEqualsDeclaration(path: NodePath<TSImportEqualsDeclaration>) {
                if (!path.node.isExport && path.node.importKind === "value" && isTSExternalModuleReference(path.node.moduleReference))
                    path.replaceWith(moduleImportsDeclaration({
                        ID: path.node.id,
                        MODULE: path.node.moduleReference.expression
                    }));
                // TODO: handle other forms of TSImportEqualsDeclaration?
            }
        }
    };
}
