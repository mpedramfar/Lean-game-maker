# Lean Game Maker usage guide
See [lean-game-skeleton](https://github.com/kbuzzard/lean-game-skeleton) for a boilerplate to start making your game. 
Read on to see more details.

## Configuration file
To start from scratch, make a Lean project and add a file named `game_config.toml` to project root.
The format of this file is mostly self-explanatory.

```
name = "**name of the game**"
version = "**"
extra_files = "extras"
intro = "path_to_the_intro_page"

[[worlds]]
name = "**name of the first world**"
id = 1
levels = [
	"path_to_the_first_level",
	"path_to_the_second_level",
	"path_to_the_third_level",
	"path_to_the_fourth_level",
]

[[worlds]]
name = "**name of the second world**"
id = 2
parents = [1]
levels = [
	"path_to_the_first_level",
	"path_to_the_second_level",
]

[[worlds]]
name = "**name of the third world**"
id = 3
parents = [1, 2]
levels = [
	"path_to_the_first_level",
	"path_to_the_second_level",
	"path_to_the_third_level",
]
```

The value of `extra_files` should be the address to a directory.
This directory will be copied into the output folder.
You can use it to store images and extra files that you want to appear in the game.

Each worlds has a unique `id` and these numbers must start at one and increase by one at each world.
Each world can have zero or more parents.
The ids of the parents must be strictly smaller than the world's id.



## Lean files
The intro page and each level are Lean files.
Inside each Lean file, use the following format to add a title to each level or world:

```lean
-- Level name : name_of_the_level
```
To add comments, hints and lemmas, use this format :

```lean
/-
Comment here
-/

/- Hint : title_of_the_hint
Content of the hint
-/

/- Lemma
Description of the lemma
-/
lemma ... :=
begin
  ...
end
```
You can use Markdown in comments and hints. It will be compiled with [showdown](http://demo.showdownjs.com/).
Theorems and examples are similar to lemmas. The only difference is that examples are shown with full solution in the webpage, but lemmas and theorems should be solved by the player.
Note that only the first lemma or theorem that appears in any level is playable.
Every theorem, lemma or example will be added to the side bar in the following levels.
To prevent a lemma from appearing in the side bar, use the following format :

```lean
/- Lemma : no-side-bar
Description of the lemma
-/
lemma ... :=
begin
  ...
end
```
The same goes for theorems and examples.
You can also add description of tactics to the side bar by

```lean
/- Tactic : name_of_the_tactic
Description of the tactic
-/
```
This description will be in the side bar from that level onward.
If you want to add a statement to the list of theorem statements in the side bar without any mention in the main page, use the format :

```lean
/- Axiom : name_of_the_axiom
statement_of_the_axiom
-/
```
This will appear in the side bar from that level onward.

If a line in not contained in a comment, lemma, theorem, example or tactic, it will be shown directly in the game. If such a line ends with ` -- hide`, it will not be shown. Alternatively, you can put a few lines inside blocks of the following format.
```lean
-- begin hide
** comment and lean code here **
-- end hide
```

 * Note that the lean segment of different problems, the lines between `-/` and `begin`, must be distinct. Even if two problems are meant to be identical, this could be achieved by adding a space at the end of the lean segment of one of them. If two problems have identical lean segments, they will not be saved properly. (See "Version and saved games" below)

## Making the game

After preparing the configuration file and the Lean files, go to the root folder of your Lean project and run
```bash
make-lean-game --outdir output_folder
```
where `output_folder` is the address of the output folder.
If the `--outdir` flag is not provided, the game will be made in the `html` folder in the Lean project directory.
In this folder, there will be a zipfile named `"name"-"version"-library.zip` that contains the `.olean` files.
Making this file takes a few seconds.
If you're changing the fomatting, but the name of the Lean files and their lean content hasn't changed.
You can run
```bash
make-lean-game --nolib
```
This way the Lean-game-maker will not generate the library zipfile, so the command runs faster.

The library file could easily become more that 20 mb.
The browser stores the content of this file in the browser `indexedDB` cache to speed up loading after the first time.
If there is any change in the version, then the new library zip file will be downloaded.
Otherwise, the cached version will be used.
When developing the game, we might change the library file (by changing the lean content of the game) many times without changing the version.
Normally this results in the browser using the old version of the library file instead of the new one, which is not ideal.
If the game is built in *development mode*, then the cached indexedDB will be cleared everytime the page loads.
To build the game in development mode, you can run 
```bash
make-lean-game --devmode
```

You can run
```bash
make-lean-game --locale=CODE
```
to use translated content for the given language code.
Of course these flags could be combined.

## Internationalization

After making the game, the project folder will contain a `locale`
subfolder containing a translation template file `content.pot`.
You can start a new translation by creating inside the `locale` folder
a folder whose name will be a language code, say `fr`. Inside that
folder, create a `LC_MESSAGES` folder containing a copy of `content.pot`
named `content.po` (hence removing the final "t" which stands for
"template"). You can then either edit this file by hand or use a
dedicated software such as [poedit](https://poedit.net/).
After addding a translation, generate the file `content.mo`.
In poedit, this can be done by simply clicking the save button.

You can then use `make-lean-game --locale=fr` to use your new
translation. 

Afer updating the game, you can merge the template file
by running, inside the `LC_MESSAGES` folder:
```bash
msgmerge content.po ../../content.pot | sponge content.po
```

## Versions and saved games

The progress of users in the game is stored in the `localStorage` of their browsers.
The saved game data consists of name, version and a list of problems and the written answers.
When the game loads, it compares the version of the saved game data and the current version of the game.
If the versions are incompatible, as described below, then the saved game data is discarded and a new game starts.
Otherwise, the game looks into the saved game data and the corresponding levels.
If the lean segment of a problem, the lines between `-/` and `begin`, is unchanged after an update, the game will remember the saved answer for that problem from before.
Any other problem, whose lean segement is not identical to the lean segment of a problem from before the update, is considered new and needs to be solved again.

The `version` of the game is a string that may or may not contain any dots (the `.` character).
If there are no dots, then major version is equal to the version. Otherwise, the major version is equal to the substring before the first dot.
We say two versions are compatible if their corresponding major version is equal.


## Lean Server
To make an interactive webpage, the javascript Lean server is used. In this repository, javascript servers for Lean 3.4.1 and Lean 3.4.2 are provided. If you're working with a different version, you need to add the required files to `src/interactive_interface/lean_server`. You would need three files, named `lean_js_js.js`, `lean_js_wasm.js` and `lean_js_wasm.wasm`.
You may find these files for most versions of lean in the following links:
- [https://github.com/leanprover-community/lean/releases](https://github.com/leanprover-community/lean/releases)
- [https://github.com/leanprover-community/lean-nightly/releases](https://github.com/leanprover-community/lean-nightly/releases)