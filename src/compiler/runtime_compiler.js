'use strict';"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var lang_1 = require('angular2/src/facade/lang');
var exceptions_1 = require('angular2/src/facade/exceptions');
var collection_1 = require('angular2/src/facade/collection');
var async_1 = require('angular2/src/facade/async');
var compile_metadata_1 = require('./compile_metadata');
var di_1 = require('angular2/src/core/di');
var style_compiler_1 = require('./style_compiler');
var view_compiler_1 = require('./view_compiler/view_compiler');
var template_parser_1 = require('./template_parser');
var directive_normalizer_1 = require('./directive_normalizer');
var metadata_resolver_1 = require('./metadata_resolver');
var component_factory_1 = require('angular2/src/core/linker/component_factory');
var config_1 = require('./config');
var ir = require('./output/output_ast');
var output_jit_1 = require('./output/output_jit');
var output_interpreter_1 = require('./output/output_interpreter');
var interpretive_view_1 = require('./output/interpretive_view');
var xhr_1 = require('angular2/src/compiler/xhr');
/**
 * An internal module of the Angular compiler that begins with component types,
 * extracts templates, and eventually produces a compiled version of the component
 * ready for linking into an application.
 */
var RuntimeCompiler = (function () {
    function RuntimeCompiler(_metadataResolver, _templateNormalizer, _templateParser, _styleCompiler, _viewCompiler, _xhr, _genConfig) {
        this._metadataResolver = _metadataResolver;
        this._templateNormalizer = _templateNormalizer;
        this._templateParser = _templateParser;
        this._styleCompiler = _styleCompiler;
        this._viewCompiler = _viewCompiler;
        this._xhr = _xhr;
        this._genConfig = _genConfig;
        this._styleCache = new Map();
        this._hostCacheKeys = new Map();
        this._compiledTemplateCache = new Map();
        this._compiledTemplateDone = new Map();
    }
    RuntimeCompiler.prototype.resolveComponent = function (componentType) {
        var compMeta = this._metadataResolver.getDirectiveMetadata(componentType);
        var hostCacheKey = this._hostCacheKeys.get(componentType);
        if (lang_1.isBlank(hostCacheKey)) {
            hostCacheKey = new Object();
            this._hostCacheKeys.set(componentType, hostCacheKey);
            assertComponent(compMeta);
            var hostMeta = compile_metadata_1.createHostComponentMeta(compMeta.type, compMeta.selector);
            this._loadAndCompileComponent(hostCacheKey, hostMeta, [compMeta], [], []);
        }
        return this._compiledTemplateDone.get(hostCacheKey)
            .then(function (compiledTemplate) { return new component_factory_1.ComponentFactory(compMeta.selector, compiledTemplate.viewFactory, componentType); });
    };
    RuntimeCompiler.prototype.clearCache = function () {
        this._styleCache.clear();
        this._compiledTemplateCache.clear();
        this._compiledTemplateDone.clear();
        this._hostCacheKeys.clear();
    };
    RuntimeCompiler.prototype._loadAndCompileComponent = function (cacheKey, compMeta, viewDirectives, pipes, compilingComponentsPath) {
        var _this = this;
        var compiledTemplate = this._compiledTemplateCache.get(cacheKey);
        var done = this._compiledTemplateDone.get(cacheKey);
        if (lang_1.isBlank(compiledTemplate)) {
            compiledTemplate = new CompiledTemplate();
            this._compiledTemplateCache.set(cacheKey, compiledTemplate);
            done =
                async_1.PromiseWrapper.all([this._compileComponentStyles(compMeta)].concat(viewDirectives.map(function (dirMeta) { return _this._templateNormalizer.normalizeDirective(dirMeta); })))
                    .then(function (stylesAndNormalizedViewDirMetas) {
                    var normalizedViewDirMetas = stylesAndNormalizedViewDirMetas.slice(1);
                    var styles = stylesAndNormalizedViewDirMetas[0];
                    var parsedTemplate = _this._templateParser.parse(compMeta, compMeta.template.template, normalizedViewDirMetas, pipes, compMeta.type.name);
                    var childPromises = [];
                    compiledTemplate.init(_this._compileComponent(compMeta, parsedTemplate, styles, pipes, compilingComponentsPath, childPromises));
                    return async_1.PromiseWrapper.all(childPromises).then(function (_) { return compiledTemplate; });
                });
            this._compiledTemplateDone.set(cacheKey, done);
        }
        return compiledTemplate;
    };
    RuntimeCompiler.prototype._compileComponent = function (compMeta, parsedTemplate, styles, pipes, compilingComponentsPath, childPromises) {
        var _this = this;
        var compileResult = this._viewCompiler.compileComponent(compMeta, parsedTemplate, new ir.ExternalExpr(new compile_metadata_1.CompileIdentifierMetadata({ runtime: styles })), pipes);
        compileResult.dependencies.forEach(function (dep) {
            var childCompilingComponentsPath = collection_1.ListWrapper.clone(compilingComponentsPath);
            var childCacheKey = dep.comp.type.runtime;
            var childViewDirectives = _this._metadataResolver.getViewDirectivesMetadata(dep.comp.type.runtime);
            var childViewPipes = _this._metadataResolver.getViewPipesMetadata(dep.comp.type.runtime);
            var childIsRecursive = collection_1.ListWrapper.contains(childCompilingComponentsPath, childCacheKey);
            childCompilingComponentsPath.push(childCacheKey);
            var childComp = _this._loadAndCompileComponent(dep.comp.type.runtime, dep.comp, childViewDirectives, childViewPipes, childCompilingComponentsPath);
            dep.factoryPlaceholder.runtime = childComp.proxyViewFactory;
            dep.factoryPlaceholder.name = "viewFactory_" + dep.comp.type.name;
            if (!childIsRecursive) {
                // Only wait for a child if it is not a cycle
                childPromises.push(_this._compiledTemplateDone.get(childCacheKey));
            }
        });
        var factory;
        if (lang_1.IS_DART || !this._genConfig.useJit) {
            factory = output_interpreter_1.interpretStatements(compileResult.statements, compileResult.viewFactoryVar, new interpretive_view_1.InterpretiveAppViewInstanceFactory());
        }
        else {
            factory = output_jit_1.jitStatements(compMeta.type.name + ".template.js", compileResult.statements, compileResult.viewFactoryVar);
        }
        return factory;
    };
    RuntimeCompiler.prototype._compileComponentStyles = function (compMeta) {
        var compileResult = this._styleCompiler.compileComponent(compMeta);
        return this._resolveStylesCompileResult(compMeta.type.name, compileResult);
    };
    RuntimeCompiler.prototype._resolveStylesCompileResult = function (sourceUrl, result) {
        var _this = this;
        var promises = result.dependencies.map(function (dep) { return _this._loadStylesheetDep(dep); });
        return async_1.PromiseWrapper.all(promises)
            .then(function (cssTexts) {
            var nestedCompileResultPromises = [];
            for (var i = 0; i < result.dependencies.length; i++) {
                var dep = result.dependencies[i];
                var cssText = cssTexts[i];
                var nestedCompileResult = _this._styleCompiler.compileStylesheet(dep.sourceUrl, cssText, dep.isShimmed);
                nestedCompileResultPromises.push(_this._resolveStylesCompileResult(dep.sourceUrl, nestedCompileResult));
            }
            return async_1.PromiseWrapper.all(nestedCompileResultPromises);
        })
            .then(function (nestedStylesArr) {
            for (var i = 0; i < result.dependencies.length; i++) {
                var dep = result.dependencies[i];
                dep.valuePlaceholder.runtime = nestedStylesArr[i];
                dep.valuePlaceholder.name = "importedStyles" + i;
            }
            if (lang_1.IS_DART || !_this._genConfig.useJit) {
                return output_interpreter_1.interpretStatements(result.statements, result.stylesVar, new interpretive_view_1.InterpretiveAppViewInstanceFactory());
            }
            else {
                return output_jit_1.jitStatements(sourceUrl + ".css.js", result.statements, result.stylesVar);
            }
        });
    };
    RuntimeCompiler.prototype._loadStylesheetDep = function (dep) {
        var cacheKey = "" + dep.sourceUrl + (dep.isShimmed ? '.shim' : '');
        var cssTextPromise = this._styleCache.get(cacheKey);
        if (lang_1.isBlank(cssTextPromise)) {
            cssTextPromise = this._xhr.get(dep.sourceUrl);
            this._styleCache.set(cacheKey, cssTextPromise);
        }
        return cssTextPromise;
    };
    RuntimeCompiler = __decorate([
        di_1.Injectable(), 
        __metadata('design:paramtypes', [metadata_resolver_1.CompileMetadataResolver, directive_normalizer_1.DirectiveNormalizer, template_parser_1.TemplateParser, style_compiler_1.StyleCompiler, view_compiler_1.ViewCompiler, xhr_1.XHR, config_1.CompilerConfig])
    ], RuntimeCompiler);
    return RuntimeCompiler;
}());
exports.RuntimeCompiler = RuntimeCompiler;
var CompiledTemplate = (function () {
    function CompiledTemplate() {
        var _this = this;
        this.viewFactory = null;
        this.proxyViewFactory = function (viewUtils, childInjector, contextEl) {
            return _this.viewFactory(viewUtils, childInjector, contextEl);
        };
    }
    CompiledTemplate.prototype.init = function (viewFactory) { this.viewFactory = viewFactory; };
    return CompiledTemplate;
}());
function assertComponent(meta) {
    if (!meta.isComponent) {
        throw new exceptions_1.BaseException("Could not compile '" + meta.type.name + "' because it is not a component.");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVudGltZV9jb21waWxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRpZmZpbmdfcGx1Z2luX3dyYXBwZXItb3V0cHV0X3BhdGgtRmNKMlM1aXAudG1wL2FuZ3VsYXIyL3NyYy9jb21waWxlci9ydW50aW1lX2NvbXBpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBQSxxQkFRTywwQkFBMEIsQ0FBQyxDQUFBO0FBQ2xDLDJCQUE0QixnQ0FBZ0MsQ0FBQyxDQUFBO0FBQzdELDJCQUtPLGdDQUFnQyxDQUFDLENBQUE7QUFDeEMsc0JBQTZCLDJCQUEyQixDQUFDLENBQUE7QUFDekQsaUNBUU8sb0JBQW9CLENBQUMsQ0FBQTtBQWdCNUIsbUJBQXlCLHNCQUFzQixDQUFDLENBQUE7QUFDaEQsK0JBQTBFLGtCQUFrQixDQUFDLENBQUE7QUFDN0YsOEJBQTJCLCtCQUErQixDQUFDLENBQUE7QUFDM0QsZ0NBQTZCLG1CQUFtQixDQUFDLENBQUE7QUFDakQscUNBQWtDLHdCQUF3QixDQUFDLENBQUE7QUFDM0Qsa0NBQXNDLHFCQUFxQixDQUFDLENBQUE7QUFDNUQsa0NBQStCLDRDQUE0QyxDQUFDLENBQUE7QUFNNUUsdUJBQTZCLFVBQVUsQ0FBQyxDQUFBO0FBQ3hDLElBQVksRUFBRSxXQUFNLHFCQUFxQixDQUFDLENBQUE7QUFDMUMsMkJBQTRCLHFCQUFxQixDQUFDLENBQUE7QUFDbEQsbUNBQWtDLDZCQUE2QixDQUFDLENBQUE7QUFDaEUsa0NBQWlELDRCQUE0QixDQUFDLENBQUE7QUFFOUUsb0JBQWtCLDJCQUEyQixDQUFDLENBQUE7QUFFOUM7Ozs7R0FJRztBQUVIO0lBTUUseUJBQW9CLGlCQUEwQyxFQUMxQyxtQkFBd0MsRUFDeEMsZUFBK0IsRUFBVSxjQUE2QixFQUN0RSxhQUEyQixFQUFVLElBQVMsRUFDOUMsVUFBMEI7UUFKMUIsc0JBQWlCLEdBQWpCLGlCQUFpQixDQUF5QjtRQUMxQyx3QkFBbUIsR0FBbkIsbUJB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QUFDO1FBRzNCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxVQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsU0FBUztZQUN4RCxPQUFBLEtBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLGFBQWEsRUFBRSxTQUFTLENBQUM7UUFBckQsQ0FBcUQsQ0FBQztJQUM1RCxDQUFDO0lBRUQsK0JBQUksR0FBSixVQUFLLFdBQXFCLElBQUksSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ2pFLHVCQUFDO0FBQUQsQ0FBQyxBQVRELElBU0M7QUFFRCx5QkFBeUIsSUFBOEI7SUFDckQsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztRQUN0QixNQUFNLElBQUksMEJBQWEsQ0FBQyx3QkFBc0IsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLHFDQUFrQyxDQUFDLENBQUM7SUFDbEcsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBJU19EQVJULFxuICBUeXBlLFxuICBKc29uLFxuICBpc0JsYW5rLFxuICBpc1ByZXNlbnQsXG4gIHN0cmluZ2lmeSxcbiAgZXZhbEV4cHJlc3Npb25cbn0gZnJvbSAnYW5ndWxhcjIvc3JjL2ZhY2FkZS9sYW5nJztcbmltcG9ydCB7QmFzZUV4Y2VwdGlvbn0gZnJvbSAnYW5ndWxhcjIvc3JjL2ZhY2FkZS9leGNlcHRpb25zJztcbmltcG9ydCB7XG4gIExpc3RXcmFwcGVyLFxuICBTZXRXcmFwcGVyLFxuICBNYXBXcmFwcGVyLFxuICBTdHJpbmdNYXBXcmFwcGVyXG59IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvY29sbGVjdGlvbic7XG5pbXBvcnQge1Byb21pc2VXcmFwcGVyfSBmcm9tICdhbmd1bGFyMi9zcmMvZmFjYWRlL2FzeW5jJztcbmltcG9ydCB7XG4gIGNyZWF0ZUhvc3RDb21wb25lbnRNZXRhLFxuICBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsXG4gIENvbXBpbGVUeXBlTWV0YWRhdGEsXG4gIENvbXBpbGVUZW1wbGF0ZU1ldGFkYXRhLFxuICBDb21waWxlUGlwZU1ldGFkYXRhLFxuICBDb21waWxlTWV0YWRhdGFXaXRoVHlwZSxcbiAgQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YVxufSBmcm9tICcuL2NvbXBpbGVfbWV0YWRhdGEnO1xuaW1wb3J0IHtcbiAgVGVtcGxhdGVBc3QsXG4gIFRlbXBsYXRlQXN0VmlzaXRvcixcbiAgTmdDb250ZW50QXN0LFxuICBFbWJlZGRlZFRlbXBsYXRlQXN0LFxuICBFbGVtZW50QXN0LFxuICBCb3VuZEV2ZW50QXN0LFxuICBCb3VuZEVsZW1lbnRQcm9wZXJ0eUFzdCxcbiAgQXR0ckFzdCxcbiAgQm91bmRUZXh0QXN0LFxuICBUZXh0QXN0LFxuICBEaXJlY3RpdmVBc3QsXG4gIEJvdW5kRGlyZWN0aXZlUHJvcGVydHlBc3QsXG4gIHRlbXBsYXRlVmlzaXRBbGxcbn0gZnJvbSAnLi90ZW1wbGF0ZV9hc3QnO1xuaW1wb3J0IHtJbmplY3RhYmxlfSBmcm9tICdhbmd1bGFyMi9zcmMvY29yZS9kaSc7XG5pbXBvcnQge1N0eWxlQ29tcGlsZXIsIFN0eWxlc0NvbXBpbGVEZXBlbmRlbmN5LCBTdHlsZXNDb21waWxlUmVzdWx0fSBmcm9tICcuL3N0eWxlX2NvbXBpbGVyJztcbmltcG9ydCB7Vmlld0NvbXBpbGVyfSBmcm9tICcuL3ZpZXdfY29tcGlsZXIvdmlld19jb21waWxlcic7XG5pbXBvcnQge1RlbXBsYXRlUGFyc2VyfSBmcm9tICcuL3RlbXBsYXRlX3BhcnNlcic7XG5pbXBvcnQge0RpcmVjdGl2ZU5vcm1hbGl6ZXJ9IGZyb20gJy4vZGlyZWN0aXZlX25vcm1hbGl6ZXInO1xuaW1wb3J0IHtDb21waWxlTWV0YWRhdGFSZXNvbHZlcn0gZnJvbSAnLi9tZXRhZGF0YV9yZXNvbHZlcic7XG5pbXBvcnQge0NvbXBvbmVudEZhY3Rvcnl9IGZyb20gJ2FuZ3VsYXIyL3NyYy9jb3JlL2xpbmtlci9jb21wb25lbnRfZmFjdG9yeSc7XG5pbXBvcnQge1xuICBDb21wb25lbnRSZXNvbHZlcixcbiAgUmVmbGVjdG9yQ29tcG9uZW50UmVzb2x2ZXJcbn0gZnJvbSAnYW5ndWxhcjIvc3JjL2NvcmUvbGlua2VyL2NvbXBvbmVudF9yZXNvbHZlcic7XG5cbmltcG9ydCB7Q29tcGlsZXJDb25maWd9IGZyb20gJy4vY29uZmlnJztcbmltcG9ydCAqIGFzIGlyIGZyb20gJy4vb3V0cHV0L291dHB1dF9hc3QnO1xuaW1wb3J0IHtqaXRTdGF0ZW1lbnRzfSBmcm9tICcuL291dHB1dC9vdXRwdXRfaml0JztcbmltcG9ydCB7aW50ZXJwcmV0U3RhdGVtZW50c30gZnJvbSAnLi9vdXRwdXQvb3V0cHV0X2ludGVycHJldGVyJztcbmltcG9ydCB7SW50ZXJwcmV0aXZlQXBwVmlld0luc3RhbmNlRmFjdG9yeX0gZnJvbSAnLi9vdXRwdXQvaW50ZXJwcmV0aXZlX3ZpZXcnO1xuXG5pbXBvcnQge1hIUn0gZnJvbSAnYW5ndWxhcjIvc3JjL2NvbXBpbGVyL3hocic7XG5cbi8qKlxuICogQW4gaW50ZXJuYWwgbW9kdWxlIG9mIHRoZSBBbmd1bGFyIGNvbXBpbGVyIHRoYXQgYmVnaW5zIHdpdGggY29tcG9uZW50IHR5cGVzLFxuICogZXh0cmFjdHMgdGVtcGxhdGVzLCBhbmQgZXZlbnR1YWxseSBwcm9kdWNlcyBhIGNvbXBpbGVkIHZlcnNpb24gb2YgdGhlIGNvbXBvbmVudFxuICogcmVhZHkgZm9yIGxpbmtpbmcgaW50byBhbiBhcHBsaWNhdGlvbi5cbiAqL1xuQEluamVjdGFibGUoKVxuZXhwb3J0IGNsYXNzIFJ1bnRpbWVDb21waWxlciBpbXBsZW1lbnRzIENvbXBvbmVudFJlc29sdmVyIHtcbiAgcHJpdmF0ZSBfc3R5bGVDYWNoZTogTWFwPHN0cmluZywgUHJvbWlzZTxzdHJpbmc+PiA9IG5ldyBNYXA8c3RyaW5nLCBQcm9taXNlPHN0cmluZz4+KCk7XG4gIHByaXZhdGUgX2hvc3RDYWNoZUtleXMgPSBuZXcgTWFwPFR5cGUsIGFueT4oKTtcbiAgcHJpdmF0ZSBfY29tcGlsZWRUZW1wbGF0ZUNhY2hlID0gbmV3IE1hcDxhbnksIENvbXBpbGVkVGVtcGxhdGU+KCk7XG4gIHByaXZhdGUgX2NvbXBpbGVkVGVtcGxhdGVEb25lID0gbmV3IE1hcDxhbnksIFByb21pc2U8Q29tcGlsZWRUZW1wbGF0ZT4+KCk7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBfbWV0YWRhdGFSZXNvbHZlcjogQ29tcGlsZU1ldGFkYXRhUmVzb2x2ZXIsXG4gICAgICAgICAgICAgIHByaXZhdGUgX3RlbXBsYXRlTm9ybWFsaXplcjogRGlyZWN0aXZlTm9ybWFsaXplcixcbiAgICAgICAgICAgICAgcHJpdmF0ZSBfdGVtcGxhdGVQYXJzZXI6IFRlbXBsYXRlUGFyc2VyLCBwcml2YXRlIF9zdHlsZUNvbXBpbGVyOiBTdHlsZUNvbXBpbGVyLFxuICAgICAgICAgICAgICBwcml2YXRlIF92aWV3Q29tcGlsZXI6IFZpZXdDb21waWxlciwgcHJpdmF0ZSBfeGhyOiBYSFIsXG4gICAgICAgICAgICAgIHByaXZhdGUgX2dlbkNvbmZpZzogQ29tcGlsZXJDb25maWcpIHt9XG5cbiAgcmVzb2x2ZUNvbXBvbmVudChjb21wb25lbnRUeXBlOiBUeXBlKTogUHJvbWlzZTxDb21wb25lbnRGYWN0b3J5PGFueT4+IHtcbiAgICB2YXIgY29tcE1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSA9XG4gICAgICAgIHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0RGlyZWN0aXZlTWV0YWRhdGEoY29tcG9uZW50VHlwZSk7XG4gICAgdmFyIGhvc3RDYWNoZUtleSA9IHRoaXMuX2hvc3RDYWNoZUtleXMuZ2V0KGNvbXBvbmVudFR5cGUpO1xuICAgIGlmIChpc0JsYW5rKGhvc3RDYWNoZUtleSkpIHtcbiAgICAgIGhvc3RDYWNoZUtleSA9IG5ldyBPYmplY3QoKTtcbiAgICAgIHRoaXMuX2hvc3RDYWNoZUtleXMuc2V0KGNvbXBvbmVudFR5cGUsIGhvc3RDYWNoZUtleSk7XG4gICAgICBhc3NlcnRDb21wb25lbnQoY29tcE1ldGEpO1xuICAgICAgdmFyIGhvc3RNZXRhOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEgPVxuICAgICAgICAgIGNyZWF0ZUhvc3RDb21wb25lbnRNZXRhKGNvbXBNZXRhLnR5cGUsIGNvbXBNZXRhLnNlbGVjdG9yKTtcblxuICAgICAgdGhpcy5fbG9hZEFuZENvbXBpbGVDb21wb25lbnQoaG9zdENhY2hlS2V5LCBob3N0TWV0YSwgW2NvbXBNZXRhXSwgW10sIFtdKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVEb25lLmdldChob3N0Q2FjaGVLZXkpXG4gICAgICAgIC50aGVuKChjb21waWxlZFRlbXBsYXRlOiBDb21waWxlZFRlbXBsYXRlKSA9PiBuZXcgQ29tcG9uZW50RmFjdG9yeShcbiAgICAgICAgICAgICAgICAgIGNvbXBNZXRhLnNlbGVjdG9yLCBjb21waWxlZFRlbXBsYXRlLnZpZXdGYWN0b3J5LCBjb21wb25lbnRUeXBlKSk7XG4gIH1cblxuICBjbGVhckNhY2hlKCkge1xuICAgIHRoaXMuX3N0eWxlQ2FjaGUuY2xlYXIoKTtcbiAgICB0aGlzLl9jb21waWxlZFRlbXBsYXRlQ2FjaGUuY2xlYXIoKTtcbiAgICB0aGlzLl9jb21waWxlZFRlbXBsYXRlRG9uZS5jbGVhcigpO1xuICAgIHRoaXMuX2hvc3RDYWNoZUtleXMuY2xlYXIoKTtcbiAgfVxuXG5cbiAgcHJpdmF0ZSBfbG9hZEFuZENvbXBpbGVDb21wb25lbnQoY2FjaGVLZXk6IGFueSwgY29tcE1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlld0RpcmVjdGl2ZXM6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YVtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXBlczogQ29tcGlsZVBpcGVNZXRhZGF0YVtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21waWxpbmdDb21wb25lbnRzUGF0aDogYW55W10pOiBDb21waWxlZFRlbXBsYXRlIHtcbiAgICB2YXIgY29tcGlsZWRUZW1wbGF0ZSA9IHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICAgIHZhciBkb25lID0gdGhpcy5fY29tcGlsZWRUZW1wbGF0ZURvbmUuZ2V0KGNhY2hlS2V5KTtcbiAgICBpZiAoaXNCbGFuayhjb21waWxlZFRlbXBsYXRlKSkge1xuICAgICAgY29tcGlsZWRUZW1wbGF0ZSA9IG5ldyBDb21waWxlZFRlbXBsYXRlKCk7XG4gICAgICB0aGlzLl9jb21waWxlZFRlbXBsYXRlQ2FjaGUuc2V0KGNhY2hlS2V5LCBjb21waWxlZFRlbXBsYXRlKTtcbiAgICAgIGRvbmUgPVxuICAgICAgICAgIFByb21pc2VXcmFwcGVyLmFsbChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBbPGFueT50aGlzLl9jb21waWxlQ29tcG9uZW50U3R5bGVzKGNvbXBNZXRhKV0uY29uY2F0KHZpZXdEaXJlY3RpdmVzLm1hcChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGlyTWV0YSA9PiB0aGlzLl90ZW1wbGF0ZU5vcm1hbGl6ZXIubm9ybWFsaXplRGlyZWN0aXZlKGRpck1ldGEpKSkpXG4gICAgICAgICAgICAgIC50aGVuKChzdHlsZXNBbmROb3JtYWxpemVkVmlld0Rpck1ldGFzOiBhbnlbXSkgPT4ge1xuICAgICAgICAgICAgICAgIHZhciBub3JtYWxpemVkVmlld0Rpck1ldGFzID0gc3R5bGVzQW5kTm9ybWFsaXplZFZpZXdEaXJNZXRhcy5zbGljZSgxKTtcbiAgICAgICAgICAgICAgICB2YXIgc3R5bGVzID0gc3R5bGVzQW5kTm9ybWFsaXplZFZpZXdEaXJNZXRhc1swXTtcbiAgICAgICAgICAgICAgICB2YXIgcGFyc2VkVGVtcGxhdGUgPVxuICAgICAgICAgICAgICAgICAgICB0aGlzLl90ZW1wbGF0ZVBhcnNlci5wYXJzZShjb21wTWV0YSwgY29tcE1ldGEudGVtcGxhdGUudGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZWRWaWV3RGlyTWV0YXMsIHBpcGVzLCBjb21wTWV0YS50eXBlLm5hbWUpO1xuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkUHJvbWlzZXMgPSBbXTtcbiAgICAgICAgICAgICAgICBjb21waWxlZFRlbXBsYXRlLmluaXQodGhpcy5fY29tcGlsZUNvbXBvbmVudChjb21wTWV0YSwgcGFyc2VkVGVtcGxhdGUsIHN0eWxlcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXBlcywgY29tcGlsaW5nQ29tcG9uZW50c1BhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRQcm9taXNlcykpO1xuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlV3JhcHBlci5hbGwoY2hpbGRQcm9taXNlcykudGhlbigoXykgPT4geyByZXR1cm4gY29tcGlsZWRUZW1wbGF0ZTsgfSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgdGhpcy5fY29tcGlsZWRUZW1wbGF0ZURvbmUuc2V0KGNhY2hlS2V5LCBkb25lKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBpbGVkVGVtcGxhdGU7XG4gIH1cblxuICBwcml2YXRlIF9jb21waWxlQ29tcG9uZW50KGNvbXBNZXRhOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsIHBhcnNlZFRlbXBsYXRlOiBUZW1wbGF0ZUFzdFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlczogc3RyaW5nW10sIHBpcGVzOiBDb21waWxlUGlwZU1ldGFkYXRhW10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcGlsaW5nQ29tcG9uZW50c1BhdGg6IGFueVtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkUHJvbWlzZXM6IFByb21pc2U8YW55PltdKTogRnVuY3Rpb24ge1xuICAgIHZhciBjb21waWxlUmVzdWx0ID0gdGhpcy5fdmlld0NvbXBpbGVyLmNvbXBpbGVDb21wb25lbnQoXG4gICAgICAgIGNvbXBNZXRhLCBwYXJzZWRUZW1wbGF0ZSxcbiAgICAgICAgbmV3IGlyLkV4dGVybmFsRXhwcihuZXcgQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YSh7cnVudGltZTogc3R5bGVzfSkpLCBwaXBlcyk7XG4gICAgY29tcGlsZVJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZGVwKSA9PiB7XG4gICAgICB2YXIgY2hpbGRDb21waWxpbmdDb21wb25lbnRzUGF0aCA9IExpc3RXcmFwcGVyLmNsb25lKGNvbXBpbGluZ0NvbXBvbmVudHNQYXRoKTtcblxuICAgICAgdmFyIGNoaWxkQ2FjaGVLZXkgPSBkZXAuY29tcC50eXBlLnJ1bnRpbWU7XG4gICAgICB2YXIgY2hpbGRWaWV3RGlyZWN0aXZlczogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhW10gPVxuICAgICAgICAgIHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0Vmlld0RpcmVjdGl2ZXNNZXRhZGF0YShkZXAuY29tcC50eXBlLnJ1bnRpbWUpO1xuICAgICAgdmFyIGNoaWxkVmlld1BpcGVzOiBDb21waWxlUGlwZU1ldGFkYXRhW10gPVxuICAgICAgICAgIHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0Vmlld1BpcGVzTWV0YWRhdGEoZGVwLmNvbXAudHlwZS5ydW50aW1lKTtcbiAgICAgIHZhciBjaGlsZElzUmVjdXJzaXZlID0gTGlzdFdyYXBwZXIuY29udGFpbnMoY2hpbGRDb21waWxpbmdDb21wb25lbnRzUGF0aCwgY2hpbGRDYWNoZUtleSk7XG4gICAgICBjaGlsZENvbXBpbGluZ0NvbXBvbmVudHNQYXRoLnB1c2goY2hpbGRDYWNoZUtleSk7XG5cbiAgICAgIHZhciBjaGlsZENvbXAgPVxuICAgICAgICAgIHRoaXMuX2xvYWRBbmRDb21waWxlQ29tcG9uZW50KGRlcC5jb21wLnR5cGUucnVudGltZSwgZGVwLmNvbXAsIGNoaWxkVmlld0RpcmVjdGl2ZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRWaWV3UGlwZXMsIGNoaWxkQ29tcGlsaW5nQ29tcG9uZW50c1BhdGgpO1xuICAgICAgZGVwLmZhY3RvcnlQbGFjZWhvbGRlci5ydW50aW1lID0gY2hpbGRDb21wLnByb3h5Vmlld0ZhY3Rvcnk7XG4gICAgICBkZXAuZmFjdG9yeVBsYWNlaG9sZGVyLm5hbWUgPSBgdmlld0ZhY3RvcnlfJHtkZXAuY29tcC50eXBlLm5hbWV9YDtcbiAgICAgIGlmICghY2hpbGRJc1JlY3Vyc2l2ZSkge1xuICAgICAgICAvLyBPbmx5IHdhaXQgZm9yIGEgY2hpbGQgaWYgaXQgaXMgbm90IGEgY3ljbGVcbiAgICAgICAgY2hpbGRQcm9taXNlcy5wdXNoKHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVEb25lLmdldChjaGlsZENhY2hlS2V5KSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdmFyIGZhY3Rvcnk7XG4gICAgaWYgKElTX0RBUlQgfHwgIXRoaXMuX2dlbkNvbmZpZy51c2VKaXQpIHtcbiAgICAgIGZhY3RvcnkgPSBpbnRlcnByZXRTdGF0ZW1lbnRzKGNvbXBpbGVSZXN1bHQuc3RhdGVtZW50cywgY29tcGlsZVJlc3VsdC52aWV3RmFjdG9yeVZhcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBJbnRlcnByZXRpdmVBcHBWaWV3SW5zdGFuY2VGYWN0b3J5KCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWN0b3J5ID0gaml0U3RhdGVtZW50cyhgJHtjb21wTWV0YS50eXBlLm5hbWV9LnRlbXBsYXRlLmpzYCwgY29tcGlsZVJlc3VsdC5zdGF0ZW1lbnRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcGlsZVJlc3VsdC52aWV3RmFjdG9yeVZhcik7XG4gICAgfVxuICAgIHJldHVybiBmYWN0b3J5O1xuICB9XG5cbiAgcHJpdmF0ZSBfY29tcGlsZUNvbXBvbmVudFN0eWxlcyhjb21wTWV0YTogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIHZhciBjb21waWxlUmVzdWx0ID0gdGhpcy5fc3R5bGVDb21waWxlci5jb21waWxlQ29tcG9uZW50KGNvbXBNZXRhKTtcbiAgICByZXR1cm4gdGhpcy5fcmVzb2x2ZVN0eWxlc0NvbXBpbGVSZXN1bHQoY29tcE1ldGEudHlwZS5uYW1lLCBjb21waWxlUmVzdWx0KTtcbiAgfVxuXG4gIHByaXZhdGUgX3Jlc29sdmVTdHlsZXNDb21waWxlUmVzdWx0KHNvdXJjZVVybDogc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IFN0eWxlc0NvbXBpbGVSZXN1bHQpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgdmFyIHByb21pc2VzID0gcmVzdWx0LmRlcGVuZGVuY2llcy5tYXAoKGRlcCkgPT4gdGhpcy5fbG9hZFN0eWxlc2hlZXREZXAoZGVwKSk7XG4gICAgcmV0dXJuIFByb21pc2VXcmFwcGVyLmFsbChwcm9taXNlcylcbiAgICAgICAgLnRoZW4oKGNzc1RleHRzKSA9PiB7XG4gICAgICAgICAgdmFyIG5lc3RlZENvbXBpbGVSZXN1bHRQcm9taXNlcyA9IFtdO1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzdWx0LmRlcGVuZGVuY2llcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGRlcCA9IHJlc3VsdC5kZXBlbmRlbmNpZXNbaV07XG4gICAgICAgICAgICB2YXIgY3NzVGV4dCA9IGNzc1RleHRzW2ldO1xuICAgICAgICAgICAgdmFyIG5lc3RlZENvbXBpbGVSZXN1bHQgPVxuICAgICAgICAgICAgICAgIHRoaXMuX3N0eWxlQ29tcGlsZXIuY29tcGlsZVN0eWxlc2hlZXQoZGVwLnNvdXJjZVVybCwgY3NzVGV4dCwgZGVwLmlzU2hpbW1lZCk7XG4gICAgICAgICAgICBuZXN0ZWRDb21waWxlUmVzdWx0UHJvbWlzZXMucHVzaChcbiAgICAgICAgICAgICAgICB0aGlzLl9yZXNvbHZlU3R5bGVzQ29tcGlsZVJlc3VsdChkZXAuc291cmNlVXJsLCBuZXN0ZWRDb21waWxlUmVzdWx0KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBQcm9taXNlV3JhcHBlci5hbGwobmVzdGVkQ29tcGlsZVJlc3VsdFByb21pc2VzKTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKG5lc3RlZFN0eWxlc0FycikgPT4ge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzdWx0LmRlcGVuZGVuY2llcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGRlcCA9IHJlc3VsdC5kZXBlbmRlbmNpZXNbaV07XG4gICAgICAgICAgICBkZXAudmFsdWVQbGFjZWhvbGRlci5ydW50aW1lID0gbmVzdGVkU3R5bGVzQXJyW2ldO1xuICAgICAgICAgICAgZGVwLnZhbHVlUGxhY2Vob2xkZXIubmFtZSA9IGBpbXBvcnRlZFN0eWxlcyR7aX1gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoSVNfREFSVCB8fCAhdGhpcy5fZ2VuQ29uZmlnLnVzZUppdCkge1xuICAgICAgICAgICAgcmV0dXJuIGludGVycHJldFN0YXRlbWVudHMocmVzdWx0LnN0YXRlbWVudHMsIHJlc3VsdC5zdHlsZXNWYXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgSW50ZXJwcmV0aXZlQXBwVmlld0luc3RhbmNlRmFjdG9yeSgpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGppdFN0YXRlbWVudHMoYCR7c291cmNlVXJsfS5jc3MuanNgLCByZXN1bHQuc3RhdGVtZW50cywgcmVzdWx0LnN0eWxlc1Zhcik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2xvYWRTdHlsZXNoZWV0RGVwKGRlcDogU3R5bGVzQ29tcGlsZURlcGVuZGVuY3kpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHZhciBjYWNoZUtleSA9IGAke2RlcC5zb3VyY2VVcmx9JHtkZXAuaXNTaGltbWVkID8gJy5zaGltJyA6ICcnfWA7XG4gICAgdmFyIGNzc1RleHRQcm9taXNlID0gdGhpcy5fc3R5bGVDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICAgIGlmIChpc0JsYW5rKGNzc1RleHRQcm9taXNlKSkge1xuICAgICAgY3NzVGV4dFByb21pc2UgPSB0aGlzLl94aHIuZ2V0KGRlcC5zb3VyY2VVcmwpO1xuICAgICAgdGhpcy5fc3R5bGVDYWNoZS5zZXQoY2FjaGVLZXksIGNzc1RleHRQcm9taXNlKTtcbiAgICB9XG4gICAgcmV0dXJuIGNzc1RleHRQcm9taXNlO1xuICB9XG59XG5cbmNsYXNzIENvbXBpbGVkVGVtcGxhdGUge1xuICB2aWV3RmFjdG9yeTogRnVuY3Rpb24gPSBudWxsO1xuICBwcm94eVZpZXdGYWN0b3J5OiBGdW5jdGlvbjtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5wcm94eVZpZXdGYWN0b3J5ID0gKHZpZXdVdGlscywgY2hpbGRJbmplY3RvciwgY29udGV4dEVsKSA9PlxuICAgICAgICB0aGlzLnZpZXdGYWN0b3J5KHZpZXdVdGlscywgY2hpbGRJbmplY3RvciwgY29udGV4dEVsKTtcbiAgfVxuXG4gIGluaXQodmlld0ZhY3Rvcnk6IEZ1bmN0aW9uKSB7IHRoaXMudmlld0ZhY3RvcnkgPSB2aWV3RmFjdG9yeTsgfVxufVxuXG5mdW5jdGlvbiBhc3NlcnRDb21wb25lbnQobWV0YTogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhKSB7XG4gIGlmICghbWV0YS5pc0NvbXBvbmVudCkge1xuICAgIHRocm93IG5ldyBCYXNlRXhjZXB0aW9uKGBDb3VsZCBub3QgY29tcGlsZSAnJHttZXRhLnR5cGUubmFtZX0nIGJlY2F1c2UgaXQgaXMgbm90IGEgY29tcG9uZW50LmApO1xuICB9XG59XG4iXX0=