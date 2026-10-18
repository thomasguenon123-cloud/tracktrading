#!/usr/bin/env python3
"""muter.py <fichier> <test> <ancien> <nouveau> [nom]

Valide une garde de test par mutation (brief 1.5) : reintroduit un ancien
defaut dans <fichier> (remplacement de <ancien> par <nouveau>, qui doit
s'appliquer EXACTEMENT une fois), lance <test> avec node --test, puis restaure
le fichier dans tous les cas.

  TOMBE        : la garde voit le defaut (attendu)
  PASSE ENCORE : garde inefficace, a renforcer
Code de sortie : 0 si TOMBE, 1 si PASSE ENCORE, 2 si mutation non applicable.
La liste des mutations rejouables est dans scripts/mutations.py.
"""
import os
import shutil
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def muter(fichier, test, ancien, nouveau, nom=''):
    """Rend 0 (TOMBE), 1 (PASSE ENCORE) ou 2 (non applicable)."""
    chemin = os.path.join(RACINE, fichier)
    with open(chemin, encoding='utf8') as f:
        source = f.read()
    n = source.count(ancien)
    if n != 1:
        print(f'[{nom}] MUTATION NON APPLICABLE ({n} occurrences)')
        return 2
    sauvegarde = chemin + '.muter-bak'
    shutil.copy(chemin, sauvegarde)
    try:
        with open(chemin, 'w', encoding='utf8') as f:
            f.write(source.replace(ancien, nouveau))
        r = subprocess.run(['node', '--test', test], capture_output=True, text=True, cwd=RACINE,
                           env={**os.environ, 'TZ': 'Europe/Paris'})
        echecs = [l for l in r.stdout.split('\n') if l.startswith('not ok')]
        if echecs:
            print(f'[{nom}] TOMBE : ' + ' | '.join(echecs))
            return 0
        print(f'[{nom}] PASSE ENCORE (garde inefficace)')
        return 1
    finally:
        shutil.move(sauvegarde, chemin)


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(2)
    sys.exit(muter(*sys.argv[1:6]))
