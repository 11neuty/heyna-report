const { test, expect } = require('@playwright/test');
const PDFDocument = require('pdfkit');
const HeynaPdfGenerator = require('../../utils/HeynaPdfGenerator');

test.describe('HeynaPdfGenerator page management', () => {
    test('footer does not create blank pages', () => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 48,
            autoFirstPage: true,
            bufferPages: true
        });

        doc.text('Content page 1');
        doc.addPage();
        doc.text('Content page 2');

        const expectedPages = HeynaPdfGenerator.pageCount(doc);

        HeynaPdfGenerator.footer(doc, expectedPages);
        HeynaPdfGenerator.validatePageCount(doc, expectedPages);

        expect(HeynaPdfGenerator.pageCount(doc)).toBe(expectedPages);
    });
});
