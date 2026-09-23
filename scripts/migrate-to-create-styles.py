#!/usr/bin/env python3
"""
Migre un fichier .tsx/.ts qui contient un `const styles = StyleSheet.create({...})`
vers le pattern `createStyles((theme) => ({...}))` + useMemo.

Usage: python3 migrate-to-create-styles.py <fichier>
"""
import re
import sys
import os

# Mapping des couleurs hex → tokens theme
HEX_TO_THEME = {
    '#FFFFFF': 'theme.surface',
    '#111111': 'theme.foreground',
    '#9A6201': 'theme.primary',
    '#9A6200': 'theme.warning',
    '#167A55': 'theme.success',
    '#176C52': 'theme.success',
    '#B4232D': 'theme.error',
    '#A43740': 'theme.error',
    '#A65300': 'theme.warning',
    '#FBBF24': 'theme.trendDown',
    '#48B889': 'theme.trendUp',
    '#7DD3A8': 'theme.trendUp',
    '#FCD34D': 'theme.trendDown',
    '#5FC497': 'theme.success',
    '#E4B257': 'theme.warning',
    '#F28B93': 'theme.error',
    '#9A6201': 'theme.primary',  # dark mode primary
    '#22A6B8': 'theme.primary',  # dark mode primary alt
    '#FBF7F0': 'theme.foreground',  # dark mode foreground
    '#171108': 'theme.background',  # dark mode background
    '#231A10': 'theme.surface',  # dark mode surface
    '#4A3823': 'theme.border',  # dark mode border
    '#C8BCAA': 'theme.muted',  # dark mode muted
    '#F5F5F5': 'theme.background',
    '#E3E3E3': 'theme.border',
    '#667085': 'theme.muted',
    '#747474': 'theme.muted',
    '#666666': 'theme.muted',
    '#D7D5DE': 'theme.border',
    '#C2891F': 'theme.primary',
}

def migrate(filepath):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return False

    text = open(filepath).read()

    # 1. Vérifier que le pattern est présent
    if 'const styles = StyleSheet.create(' not in text:
        print(f"No StyleSheet.create block in {filepath}")
        return False

    # 2. Vérifier que createStyles n'est pas déjà utilisé
    if 'createStyles' in text:
        print(f"Already migrated: {filepath}")
        return False

    # 3. Ajouter l'import createStyles (après le premier import de useThemeColors)
    if 'useThemeColors' in text:
        text = re.sub(
            r'(import \{ useThemeColors[^}]*\} from "@/lib/use-theme-colors";)',
            r'\1\nimport { createStyles } from "@/lib/create-styles";',
            text
        )
    else:
        # Si pas de useThemeColors, ajouter après le premier import
        text = re.sub(
            r'(import [^\n]+;)',
            r'import { createStyles } from "@/lib/create-styles";\n\1',
            text,
            count=1
        )

    # 4. Remplacer les valeurs hex dans le bloc styles par theme.X
    # D'abord identifier le bloc
    pattern = r'(const styles = StyleSheet\.create\(\{)([\s\S]*?)(\}\);)'

    def replace_in_block(match):
        prefix = match.group(1)
        body = match.group(2)
        suffix = match.group(3)

        # Remplacer chaque hex par theme.X dans le body
        for hex, token in HEX_TO_THEME.items():
            body = body.replace(f'"{hex}"', token)

        # Convertir le bloc en factory createStyles
        return f'const stylesFor = createStyles((theme: ThemedColors) => ({{{body}}}));'

    text = re.sub(pattern, replace_in_block, text, count=1)

    # 5. Ajouter ThemedColors aux imports si nécessaire
    if 'ThemedColors' in text and 'type ThemedColors' not in text:
        # Ajouter ThemedColors au import existant de use-theme-colors
        if 'useThemeColors, type ThemedColors' not in text:
            text = re.sub(
                r'import \{ useThemeColors \} from "@/lib/use-theme-colors";',
                'import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";',
                text
            )

    # 6. Ajouter useMemo + styles dans chaque composant qui utilise styles
    # Trouver les déclarations `const { colors: theme } = useThemeColors();`
    # et ajouter après : const styles = useMemo(() => stylesFor(theme), [theme]);
    if 'const { colors: theme } = useThemeColors();' in text:
        text = text.replace(
            'const { colors: theme } = useThemeColors();',
            'const { colors: theme } = useThemeColors();\n  const styles = useMemo(() => stylesFor(theme), [theme]);',
            1
        )

    # 7. Ajouter useMemo aux imports si pas présent
    if 'useMemo' in text and 'import { useMemo' not in text:
        # Trouver la ligne d'import React
        react_import = re.search(r'import \{([^}]*)\} from "react";', text)
        if react_import:
            existing = react_import.group(1)
            if 'useMemo' not in existing:
                new_imports = existing.strip() + ', useMemo' if existing.strip() else 'useMemo'
                text = text.replace(
                    react_import.group(0),
                    f'import {{{new_imports}}} from "react";'
                )

    open(filepath, 'w').write(text)
    return True

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 migrate-to-create-styles.py <file1> [file2 ...]")
        sys.exit(1)

    for f in sys.argv[1:]:
        print(f"Migrating {f}...")
        success = migrate(f)
        if success:
            print(f"  ✓ {f}")
        else:
            print(f"  ✗ {f} (skipped)")
