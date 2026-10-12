import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const appRoot = fileURLToPath(new URL('../apps/web/src/app/', import.meta.url));
const componentPath = /(?:^|\/)[^/]+\.component\.ts$/;
const featurePath = /^features\/([^/]+)\//;

/**
 * Inspect one Angular source file. Paths are relative to apps/web/src/app.
 * Exports this pure function so rules can be tested with synthetic source.
 */
export function checkWebSource(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = [];
  const report = (node, rule, message) => {
    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
    diagnostics.push({ file, line: location.line + 1, rule, message });
  };

  const checkModule = (node, specifier) => {
    if (!specifier.startsWith('.')) return;
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    const owner = featurePath.exec(file)?.[1];
    const importedOwner = featurePath.exec(target)?.[1];

    if ((file.startsWith('core/') || file.startsWith('shared/')) && importedOwner) {
      report(node, 'infrastructure-boundary', 'core/shared must not import feature code');
    }
    if (owner && importedOwner && owner !== importedOwner) {
      report(node, 'feature-boundary', 'feature code must not deep-import another feature; extract a shared contract');
    }
    if (file.includes('/state/') && (/(?:^|\/)[^/]+\.component(?:\.ts)?$/.test(target) ||
        /\/(?:ui|pages)\//.test(target))) {
      report(node, 'state-boundary', 'feature state must not depend on components or presentation layers');
    }
    if (file.includes('/data-access/') &&
        (/(?:^|\/)[^/]+\.component(?:\.ts)?$/.test(target) || /\/(?:ui|pages|state)\//.test(target))) {
      report(node, 'transport-boundary', 'data-access must not import state or presentation code');
    }
  };

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      checkModule(node, specifier);

      if (componentPath.test(file) && specifier === '@angular/common/http' &&
          ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.some((element) =>
            (element.propertyName ?? element.name).text === 'HttpClient') ||
          ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
          ts.isNamespaceImport(node.importClause.namedBindings)) {
        report(node, 'component-http', 'components must use feature data-access rather than HttpClient');
      }
      if (file.includes('/ui/') && specifier === '@angular/common/http') {
        report(node, 'ui-http', 'presentational UI must not import Angular HTTP types or services');
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      checkModule(node, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return diagnostics;
}

function* sourcePaths(folder, relative = '') {
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = posix.join(relative, entry.name);
    if (entry.isDirectory()) yield* sourcePaths(posix.join(folder, entry.name), child);
    else if (entry.isFile() && child.endsWith('.ts') && !child.endsWith('.d.ts')) yield child;
  }
}

export function scanWebSources(root = appRoot) {
  const files = [...sourcePaths(root)];
  const violations = files.flatMap((file) => checkWebSource(file, readFileSync(posix.join(root, file), 'utf8')));
  return { files: files.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scanWebSources();
  for (const item of result.violations) {
    console.error(item.file + ':' + item.line + ' [' + item.rule + '] ' + item.message);
  }
  if (result.violations.length) {
    console.error('Angular architecture boundaries: ' + result.violations.length + ' violation(s).');
    process.exitCode = 1;
  } else {
    console.log('Angular architecture boundaries: ' + result.files + ' TypeScript files checked, no violations.');
  }
}
