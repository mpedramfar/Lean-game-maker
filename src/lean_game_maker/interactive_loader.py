#!/usr/bin/env python3
import os
import zipfile, subprocess, json, re
import glob, distutils.dir_util
from pathlib import Path
import toml


class InteractiveServer:
    def __init__(self, interactive_path, outdir, library_zip_fn):
        self.interactive_path = interactive_path
        self.outdir = outdir
        self.library_zip_fn = str( (Path(self.outdir) / library_zip_fn).resolve() )

        try:
            leanpkg_toml = toml.load('leanpkg.toml')
        except FileNotFoundError:
            raise FileNotFoundError("Couldn't find a leanpkg.toml, I give up.")
        toolchain = leanpkg_toml['package']['lean_version']

        if os.name == 'nt':
            self.js_wasm_path = Path(self.interactive_path / 'lean_server' / toolchain.replace(':', ' '))
        else:
            self.js_wasm_path = Path(self.interactive_path / 'lean_server' / toolchain)

    def make_library(self):
        library_zip_fn = self.library_zip_fn
        
        source_lib = "."
        source_lib_path = str(Path(source_lib).resolve()) + '/src'

        subprocess.call(['leanpkg', 'build'])

        print('Using lean version:')
        lean_version = subprocess.run(['lean', '-v'], capture_output=True, encoding="utf-8").stdout
        print(lean_version)
        lean_githash = re.search("commit ([a-z0-9]{12}),", lean_version).group(1)
        # assume leanprover-community repo
        core_url = 'https://raw.githubusercontent.com/leanprover-community/lean/{0}/library/'.format(lean_githash)
        core_name = 'lean/library'

        lean_p = json.loads(subprocess.check_output(['lean', '-p']))
        lean_path = [Path(p).resolve() for p in lean_p["path"]]

        already_seen = set()
        lib_info = {}
        oleans = {}
        num_olean = {}
        Path(library_zip_fn).parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(library_zip_fn, mode='w', compression=zipfile.ZIP_DEFLATED, allowZip64=False, compresslevel=9) as zf:
            for p in lean_path:
                parts = p.parts
                if str(p.resolve()) == source_lib_path: # if using source_lib/src
                    lib_name = parts[-2]
                    lib_info[lib_name] = '/library/' + lib_name
                elif parts[-1] != 'library':
                    lib_name = parts[-2] # assume lean_path contains _target/deps/name/src
                    git_dir = str(p.parent)+'/.git'
                    lib_rev = subprocess.run(['git', '--git-dir='+git_dir, 'rev-parse', 'HEAD'], capture_output=True, encoding="utf-8").stdout.rstrip()
                    lib_repo_url = subprocess.run(['git', '--git-dir='+git_dir, 'config', '--get', 'remote.origin.url'], capture_output=True, encoding="utf-8").stdout.rstrip()
                    # assume that repos are hosted at github
                    lib_repo_match = re.search(r'github\.com[:/]([^\.]*)', lib_repo_url)
                    if lib_repo_match:
                        lib_repo = lib_repo_match.group(1)
                        lib_info[lib_name] = 'https://raw.githubusercontent.com/{0}/{1}/src/'.format(lib_repo, lib_rev)
                    elif lib_repo_url:
                        lib_info[lib_name] = lib_repo_url
                    else:
                        lib_info[lib_name] = '/library/' + lib_name
                else:
                    lib_name = core_name
                    lib_info[lib_name] = core_url
                if lib_name not in num_olean.keys():
                    num_olean[lib_name] = 0
                for fn in p.glob('**/*.olean'):
                    rel = fn.relative_to(p)
                    # ignore transitive dependencies
                    if '_target' in rel.parts:
                        continue
                    # ignore olean files from deleted / renamed lean files
                    if not fn.with_suffix('.lean').is_file():
                        continue
                    elif rel in already_seen:
                        print('duplicate: {0}'.format(fn))
                    else:
                        zf.write(fn, arcname=str(rel))
                        oleans[str(rel)[:-6]] = lib_name
                        num_olean[lib_name] += 1
                        already_seen.add(rel)
                if num_olean[lib_name] == 0:
                    del lib_info[lib_name]
                else:
                    print('Added {0} olean files from {1}'.format(num_olean[lib_name], lib_name))
        print('Created {0} with {1} olean files'.format(library_zip_fn, len(already_seen)))

        library_prefix = os.path.splitext(library_zip_fn)[0]
        info_fn = library_prefix + '.info.json'
        with open(info_fn, 'w') as f:
                json.dump(lib_info, f, separators=(',', ':'))
                f.write('\n')
                print('Wrote info to {0}'.format(info_fn))

        map_fn = library_prefix + '.olean_map.json'
        with open(map_fn, 'w') as f:
                json.dump(oleans, f, separators=(',', ':'))
                f.write('\n')
                print('Wrote olean map to {0}'.format(map_fn))        

    def check_server_exists(self):
        self.js_wasm_path.mkdir(parents=True, exist_ok=True)
        for f in ['lean_js_js.js', 'lean_js_wasm.js', 'lean_js_wasm.wasm']:
            if not (self.js_wasm_path/f).is_file():
                raise FileNotFoundError(f'Could not find the file "{self.js_wasm_path/f}" which is necessary to run Lean in the browser.')


    def copy_files(self, make_lib=True):
        self.check_server_exists()
        
        distutils.dir_util.copy_tree(self.interactive_path / 'dist', str(Path(self.outdir)))
        distutils.dir_util.copy_tree(self.js_wasm_path, str(Path(self.outdir)))
        if make_lib:
            self.make_library()