from setuptools import setup, find_packages
from pathlib import Path
import glob

interactive_files = []

for f in glob.glob('src/interactive_interface/dist/**', recursive=True):
    if not Path(f).is_dir():
        interactive_files.append('..' + f[3:])

for f in glob.glob('src/interactive_interface/lean_server/**', recursive=True):
    if not Path(f).is_dir():
        interactive_files.append('..' + f[3:])



setup(
    name='Lean game maker',
    version='0.0.1',
    author='Mohammad Pedramfar',
    author_email='m.pedramfar15@imperial.ac.uk',
    description='A Lean game maker',
    packages=find_packages('src'),
    package_dir={'': 'src'},
    package_data={
        '': ['*.css', '*.css.map', '*.js', 'templates/*'] + interactive_files,
    },
    entry_points=dict(
        console_scripts=['make-lean-game = lean_game_maker.cli:main'],
    ),
    install_requires=['regex >= 2018.7.11', 'jinja2 >= 2.10', 'mistletoe >= 0.7.1', 'toml >= 0.10.0', 'fire >= 0.1.3', 'jsonpickle >= 1.2', 'polib >= 1.1.0'])

