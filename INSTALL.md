# Lean Game Maker full install guide

This guide assumes you use a Debian-based Linux (e.g. Ubuntu), although
it may hopefully be somewhat relevant to more exotic operating systems.
It will install this software in an isolated environment. Of course this
means wasting some space, but it guarantees no unwanted side effects.

## Python 3.7

You need a recent python, at least python 3.7, because we use 
the [dataclass decorator](https://docs.python.org/3.7/library/dataclasses.html#module-dataclasses). An easy way to arrange that is to use [PyEnv](https://github.com/pyenv/pyenv).
```bash
git clone https://github.com/pyenv/pyenv.git ~/.pyenv
```
You need to make sure your shell will find pyenv, for instance typing:
```bash
echo 'export PATH="$HOME/.pyenv/bin:$PATH"' >> ~/.bashrc
```

You are now ready to download python 3.7. It will be installed in your
home directory, but you still need some system-wide library support. A
good way to make sure everything is there is to run:
```bash
sudo apt install -y make build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev xz-utils tk-dev libffi-dev liblzma-dev python-openssl
```
or the equivalent command for non-Debian distributions.

Then restart a shell in order to get your new PATH variable (or use
`source ~/.bashrc`) and install the python version you need.
```bash
pyenv install 3.7.2
```
You should now have a working copy of python 3.7.2 hidden in
`$HOME/.pyenv/versions/3.7.2` (pyenv does not do anything outside of
this `.pyenv` folder, so you can very easily get rid of it by deleting
this folder, and unsetting the PATH variable addition).

We will now prepare for a virtual environment dedicated to
`lean_env`. The most convenient way is to use a system-wide
`virtualenvwrapper`, setting three shell environment variables to
configure it:
```bash
sudo apt install virtualenv python3-pip
sudo -H pip3 install virtualenvwrapper
echo -e 'export WORKON_HOME=$HOME/.virtualenvs\nexport VIRTUALENVWRAPPER_PYTHON=/usr/bin/python3\nsource /usr/local/bin/virtualenvwrapper.sh' >> ~/.bashrc
```
And then create a virtual environment for `lean_env` (after
restarting you shell, or at least sourcing bashrc in order to get those
variables set) typing in your home: 
```bash
mkvirtualenv --python=$HOME/.pyenv/versions/3.7.2/bin/python lean_env
```

## Install `Lean-game-maker`

Install [`nodejs`](https://nodejs.org/en/download/) and clone the repository. Inside the virtual environment and in the root folder of the repository, type 
```bash
cd src/interactive_interface
npm install .
./node_modules/.bin/webpack --mode=production
cd ../..

pip3 install -e .
```
