from datetime import datetime
from pathlib import Path
from polib import POFile, POEntry
import gettext
import subprocess



class Translator:
    def __init__(self, locale, version):
        self.pot = POFile(check_for_duplicate=True)
        self.pot.metadata = {
        	'Project-Id-Version': version,
        	'POT-Creation-Date': str(datetime.now()),
        	'MIME-Version': '1.0',
        	'Content-Type': 'text/plain; charset=utf-8',
        }

        (Path('.')/'locale').mkdir(exist_ok=True)
        self.languages = locale.lower().split('+')
        self.translations =[gettext.translation('content', localedir=Path('.')/'locale',
                languages=[lang], fallback=True) for lang in self.languages]

        self.original_texts = []
        self.translated_texts = [[] for lang in self.languages]

        self.occ = None
    
    def save_pot(self):
        pot_path = Path('.')/'locale'/'content.pot'
        self.pot.save(pot_path)
        proc = subprocess.run(['msguniq', str(pot_path)], stdout=subprocess.PIPE)
        pot_path.write_text(proc.stdout.decode())

    def register(self, text: str, translatable: bool, lean_lines=False, occ=None) -> str:
        if not occ:
            occ = self.occ
        self.original_texts.append(text)
        if translatable and lean_lines:
            lines = text.split('\n')
            translated_lines = [text.split('\n') for lang in self.languages]
            for i, line in enumerate(lines):
                if '--' in line:
                    for l in range(len(self.languages)):
                        translated_lines[l][i] = self.translations[l].gettext(line)
                    self.pot.append(POEntry(msgid=line, occurrences=[(occ, '')]))
            for l in range(len(self.languages)):
                self.translated_texts[l].append('\n'.join(translated_lines[l]))
        elif translatable:
            self.pot.append(POEntry(msgid=text, occurrences=[(occ, '')]))
            for l in range(len(self.languages)):
                self.translated_texts[l].append(self.translations[l].gettext(text))
        else:
            for l in range(len(self.languages)):
                self.translated_texts[l].append(text)
        
        return str(len(self.original_texts) - 1)
