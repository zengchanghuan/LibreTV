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
vendor = sorted((root / 'Vendor/ZFPlayer').rglob('*.m'))
for file in vendor:
    name = str(file.relative_to(root))
    add(name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; path = "{name}"; sourceTree = SOURCE_ROOT;')
    add('build'+name, f'isa = PBXBuildFile; fileRef = {uid(name)};')
add('zfresources', 'isa = PBXFileReference; lastKnownFileType = wrapper.plug-in; path = Vendor/ZFPlayer/ControlView/ZFPlayer.bundle; sourceTree = SOURCE_ROOT;')
add('zflicense', 'isa = PBXFileReference; lastKnownFileType = text; path = Vendor/ZFPlayer/LICENSE; sourceTree = SOURCE_ROOT;')
add('buildzflicense', f'isa = PBXBuildFile; fileRef = {uid("zflicense")};')
add('buildzfresources', f'isa = PBXBuildFile; fileRef = {uid("zfresources")};')
add('vendor', 'isa = PBXGroup; name = ZFPlayer; sourceTree = "<group>"; children = ('+','.join([uid(str(f.relative_to(root))) for f in vendor]+[uid('zfresources'), uid('zflicense')])+');')
add('plist', 'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
add('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";')
add('buildassets', f'isa = PBXBuildFile; fileRef = {uid("assets")};')
add('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = LibreTV.app; sourceTree = BUILT_PRODUCTS_DIR;')
add('sources', 'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join([uid('build'+f.name) for f in files]+[uid('build'+str(f.relative_to(root))) for f in vendor])+'); runOnlyForDeploymentPostprocessing = 0;')
add('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
add('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("buildassets")}, {uid("buildzfresources")}, {uid("buildzflicense")}); runOnlyForDeploymentPostprocessing = 0;')
add('codegroup', 'isa = PBXGroup; path = LibreTV; sourceTree = "<group>"; children = ('+','.join([uid(f.name) for f in files]+[uid('plist'), uid('assets')])+');')
add('products', f'isa = PBXGroup; name = Products; sourceTree = "<group>"; children = ({uid("product")});')
add('rootgroup', f'isa = PBXGroup; sourceTree = "<group>"; children = ({uid("codegroup")}, {uid("vendor")}, {uid("products")});')
for mode in ['Debug','Release']:
    add('project'+mode, f'isa = XCBuildConfiguration; name = {mode}; buildSettings = {{ SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 16.0; CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; SWIFT_VERSION = 5.0; }};')
    debug = 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; SWIFT_OPTIMIZATION_LEVEL = "-Onone";' if mode == 'Debug' else 'SWIFT_OPTIMIZATION_LEVEL = "-O"; VALIDATE_PRODUCT = YES;'
    add('target'+mode, f'isa = XCBuildConfiguration; name = {mode}; buildSettings = {{ ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; PRODUCT_NAME = LibreTV; PRODUCT_BUNDLE_IDENTIFIER = app.libretv.family; CODE_SIGN_STYLE = Automatic; INFOPLIST_FILE = LibreTV/Info.plist; SWIFT_OBJC_BRIDGING_HEADER = "LibreTV/LibreTV-Bridging-Header.h"; HEADER_SEARCH_PATHS = "$(SRCROOT)/Vendor/ZFPlayer/**"; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTS_MACCATALYST = NO; GENERATE_INFOPLIST_FILE = NO; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; {debug} }};')
for name in ['project','target']:
    add(name+'configs', f'isa = XCConfigurationList; buildConfigurations = ({uid(name+"Debug")}, {uid(name+"Release")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
add('target', f'isa = PBXNativeTarget; name = LibreTV; productName = LibreTV; productType = "com.apple.product-type.application"; productReference = {uid("product")}; buildConfigurationList = {uid("targetconfigs")}; buildPhases = ({uid("sources")}, {uid("frameworks")}, {uid("resources")}); buildRules = (); dependencies = ();')
add('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; }}; buildConfigurationList = {uid("projectconfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en, Base); mainGroup = {uid("rootgroup")}; productRefGroup = {uid("products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")});')
(root / 'LibreTV.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+f'\n}}; rootObject = {uid("project")}; }}\n')
