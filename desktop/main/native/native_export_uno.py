# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""PDF export of the URL-bound Writer model without changing its visible view."""


def state(model):
    manager = model.getUndoManager()
    view = model.getCurrentController().getViewSettings()
    return dict(url=model.getURL(), modified=model.isModified(),
                modifiedEnabled=model.isSetModifiedEnabled(), readonly=model.isReadonly(),
                tracking=model.getPropertyValue('RecordChanges'),
                display=model.getPropertyValue('RedlineDisplayType'),
                margin=view.getPropertyValue('ShowChangesInMargin'),
                undo=list(manager.getAllUndoActionTitles()), redo=list(manager.getAllRedoActionTitles()))


def export_pdf(model, uno_mod, output_path):
    if not model.supportsService('com.sun.star.text.TextDocument'):
        raise ValueError('Native PDF export requires a Writer document')
    if not isinstance(output_path, str) or not output_path.startswith('/'):
        raise ValueError('Native PDF export requires an owned absolute output path')
    before = state(model)
    if not before['url'] or type(before['modified']) is not bool:
        raise RuntimeError('PDF export source state is unavailable')
    properties = []
    for name, value in [('FilterName', 'writer_pdf_Export'), ('Overwrite', True)]:
        prop = uno_mod.createUnoStruct('com.sun.star.beans.PropertyValue')
        prop.Name, prop.Value = name, value
        properties.append(prop)
    try:
        # storeToURL exports a copy; storeAsURL/saveAs would take ownership.
        # Unlike DOCX export, PDF intentionally uses the current visible view.
        model.storeToURL(uno_mod.systemPathToFileUrl(output_path), tuple(properties))
    finally:
        try:
            if model.isModified() != before['modified']:
                model.setModified(before['modified'])
            if state(model) != before:
                raise RuntimeError('source URL, view, tracking or undo state changed')
        except Exception as error:
            raise RuntimeError('PDF_EXPORT_OUTCOME_UNKNOWN: ' + str(error)) from error
    return dict(success=True)
