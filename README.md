# Lean Game Maker

This prototype is a library which renders structured Lean files into an interactive game with a javascript Lean server running on the browser.

## Installation

See the [installation guide](https://github.com/mpedramfar/Lean-game-maker/blob/master/INSTALL.md).

## Usage

Make a Lean project and add a folder named `game` to the `src` path. For every world, add a folder to `game` and name them `world1`, `world2`, ... . Inside each world, add files `level1.lean`, `level2.lean`, ... for every level in the corresponding world. Inside each Lean file, use the following format for comment and lemmas:

```lean
/-
Comment here
-/

/- Lemma
Description of the lemma
-/
lemma ... :=
begin
  ...
end
```
You can use Markdown in the comments. It will be compiled with [showdown](http://demo.showdownjs.com/).
Theorems and examples are similar to lemmas. The only difference is that examples are shown with full solution in the webpage, but lemmas and theorems should be solved by the player. If a line in not contained in a comment, lemma, theorem or example. Then it will be shown directly in the game. If such a line ends with ` -- hide`, it will not be shown. Alternatively, you can put a few lines inside blocks of the following format.
```lean
-- begin hide
** comment and lean code here **
-- end hide
```

After preparing the Lean files, go to the root folder of your Lean project and run
```bash
make-lean-game
```

### Lean Server
- To make an interactive webpage, the javascript Lean server is used. In this repository, javascript servers for Lean 3.4.1 and Lean 3.4.2 are provided. If you're working with a different version, you need to add the required files to `src/interactive_interface/lean_server`. You would need three files, named `lean_js_js.js`, `lean_js_wasm.js` and `lean_js_wasm.wasm`.
- This project uses IndexDB to store some data through the browser. If you're running `make-lean-game` but there are import errors or your changes are not reflected in the imported files, then [delete IndexDB](https://stackoverflow.com/questions/9384128/how-to-delete-indexeddb) and run the webpage again.
