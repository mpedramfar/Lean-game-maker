import distutils.dir_util
from fire import Fire
from pathlib import Path
import jsonpickle
import toml

import lean_game_maker
from lean_game_maker.line_reader import FileReader
from lean_game_maker.translator import Translator
from lean_game_maker.objects import default_line_handler, readers_list
from lean_game_maker.interactive_loader import InteractiveServer

module_path = Path(lean_game_maker.__file__).parent
interactive_path = module_path.parent / 'interactive_interface'

def render_lean_project(outdir=None, nolib=False, devmode=False, locale='en'):

    outdir = outdir or 'html'
    Path(outdir).mkdir(exist_ok=True)


    game_config = toml.load('game_config.toml')
    ### TODO: check for errors

    if 'extra_files' in game_config and Path(game_config['extra_files']).is_dir():
        distutils.dir_util.copy_tree(str(Path('.')/game_config['extra_files']), str(Path(outdir)/game_config['extra_files']))


    name = game_config.get('name', 'Lean game')
    version = str(game_config.get('version', ''))
    translator = Translator(locale, version)

    game_data = {
        'name'   : name,
        'version': version, 
        'languages': translator.languages,
        'translated_name': translator.register(name, True, occ='game_config'),
        'devmode': devmode,
        'library_zip_fn': f'{name}-{version}-library.zip',
        'introData': {},
        'worlds' : [],
        'texts': {},
    }


    InteractiveServer(interactive_path=interactive_path, outdir=outdir,
            library_zip_fn= game_data['library_zip_fn']).copy_files(make_lib = not nolib)


    file_reader = FileReader(translator, default_line_handler, readers_list)

    print(f"Intro page ...", end="")
    game_data['introData'] = file_reader.read_file(game_config['intro'], occ='intro')
    game_data['introData']['problemIndex'] = -1
    print(f"\rIntro page ... done")

    for w, world_config in enumerate(game_config['worlds']):
        print(f"{world_config['name']} :")

        world_data = { 
            'name': translator.register(world_config['name'], True, occ='world_config'), 
            'levels' : [] 
        }

        if world_config.get('id', w+1) != w+1:
            raise Exception("World id must start with 1 and increase by 1 at each world.")

        if 'parents' in world_config:
            world_data['parents'] = []
            for i in world_config['parents']:
                if i >= w+1:
                    raise Exception("Parent ID must be smaller than the world ID.")
                world_data['parents'].append(i-1)

        for i, level_address in enumerate(world_config['levels']):
            print(f"\tlevel {i+1} ...", end="")
            level_data = file_reader.read_file(level_address, occ=f"{world_config['name']} level {i+1}")
            world_data['levels'].append(level_data)
            print(f"\r\tlevel {i+1} ... done")

        if world_data['levels']:
            game_data['worlds'].append(world_data)
        else:
            raise Exception(f'World {w+1} has no levels.')

    game_data['texts'] = translator.translated_texts

    with open(str(Path(outdir)/'game_data.json'), 'w', encoding='utf8') as f:
        f.write(jsonpickle.encode(game_data, unpicklable=False))

    translator.save_pot()


def main():
    try:
        Fire(render_lean_project)
    except Exception as e:
        print('\n\nError:', e)
