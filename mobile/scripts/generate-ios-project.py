#!/usr/bin/env python3
"""Generate a deterministic Xcode project without third-party tooling."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[1] / 'ios'
def uid(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
objects = []
def add(name, body): objects.append(f'{uid(name)} = {{ {body} }};')
files = sorted((root / 'LibreTV').glob('*.swift'))
for file in files:
    add(file.name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {file.name}; sourceTree = "<group>";')
    add('build'+file.name, f'isa = PBXBuildFile; fileRef = {uid(file.name)};')
add('plist', 'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
add('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";')
add('buildassets', f'isa = PBXBuildFile; fileRef = {uid("assets")};')
add('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = LibreTV.app; sourceTree = BUILT_PRODUCTS_DIR;')
add('sources', 'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join(uid('build'+f.name) for f in files)+'); runOnlyForDeploymentPostprocessing = 0;')
add('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
add('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("buildassets")}); runOnlyForDeploymentPostprocessing = 0;')
add('codegroup', 'isa = PBXGroup; path = LibreTV; sourceTree = "<group>"; children = ('+','.join([uid(f.name) for f in files]+[uid('plist'), uid('assets')])+');')
add('products', f'isa = PBXGroup; name = Products; sourceTree = "<group>"; children = ({uid("product")});')
add('rootgroup', f'isa = PBXGroup; sourceTree = "<group>"; children = ({uid("codegroup")}, {uid("products")});')
for mode in ['Debug','Release']:
    add('project'+mode, f'isa = XCBuildConfiguration; name = {mode}; buildSettings = {{ SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 16.0; CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0; }};')
    debug = 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; SWIFT_OPTIMIZATION_LEVEL = "-Onone";' if mode == 'Debug' else 'SWIFT_OPTIMIZATION_LEVEL = "-O"; VALIDATE_PRODUCT = YES;'
    add('target'+mode, f'isa = XCBuildConfiguration; name = {mode}; buildSettings = {{ ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; PRODUCT_NAME = LibreTV; PRODUCT_BUNDLE_IDENTIFIER = app.libretv.family; CODE_SIGN_STYLE = Automatic; INFOPLIST_FILE = LibreTV/Info.plist; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTS_MACCATALYST = NO; GENERATE_INFOPLIST_FILE = NO; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; {debug} }};')
for name in ['project','target']:
    add(name+'configs', f'isa = XCConfigurationList; buildConfigurations = ({uid(name+"Debug")}, {uid(name+"Release")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
add('target', f'isa = PBXNativeTarget; name = LibreTV; productName = LibreTV; productType = "com.apple.product-type.application"; productReference = {uid("product")}; buildConfigurationList = {uid("targetconfigs")}; buildPhases = ({uid("sources")}, {uid("frameworks")}, {uid("resources")}); buildRules = (); dependencies = ();')
add('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; }}; buildConfigurationList = {uid("projectconfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en, Base); mainGroup = {uid("rootgroup")}; productRefGroup = {uid("products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")});')
(root / 'LibreTV.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+f'\n}}; rootObject = {uid("project")}; }}\n')
