import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

export async function navigationPdf() {
  const pdf = await PDFDocument.create(), first = pdf.addPage([600,800]), second = pdf.addPage([600,800]);
  first.drawText('Contents: links, bookmarks and annotations', {x:40,y:740,size:14}); second.drawText('Chapter 1', {x:40,y:740,size:18});
  const dest = pdf.context.obj([second.ref,'Fit']);
  const link = action => pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[40,500,250,540],A:pdf.context.register(pdf.context.obj(action))}));
  first.node.set(PDFName.of('Annots'),pdf.context.obj([
    link({S:'URI',URI:PDFString.of('https://example.test/help%20document?q=1#chapter')}),
    link({S:'URI',URI:PDFString.of('https://example.test/help document.pdf')}),
    link({S:'URI',URI:PDFHexString.fromText('http://example.test/manual')}),
    link({S:'URI',URI:PDFString.of('../guide')}),
    link({S:'GoTo',D:dest}), link({S:'GoTo',D:PDFString.of('chapter-1')}),
    link({S:'GoTo',D:[second.ref,'XYZ',null,null,0]}), link({S:'GoTo',D:PDFName.of('chapter-1')}),
    link({S:'Named',N:'NextPage'}),
    pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[40,450,250,480],Dest:dest})),
    pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[20,20,50,50],Contents:PDFString.of('Harmless note')})),
    pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Highlight',Rect:[20,50,150,80],QuadPoints:[20,80,150,80,20,50,150,50],C:[1,1,0]})),
  ]));
  pdf.catalog.set(PDFName.of('URI'),pdf.context.obj({Base:PDFString.of('https://example.test/manual/')}));
  pdf.catalog.set(PDFName.of('Names'),pdf.context.obj({Dests:{Names:[PDFString.of('chapter-1'),dest]}}));
  const outline = pdf.context.obj({Type:'Outlines',Count:1}), outlineRef = pdf.context.register(outline);
  const chapter = pdf.context.register(pdf.context.obj({Title:PDFString.of('Chapter 1'),Parent:outlineRef,Dest:dest}));
  outline.set(PDFName.of('First'),chapter); outline.set(PDFName.of('Last'),chapter); pdf.catalog.set(PDFName.of('Outlines'),outlineRef);
  pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.obj([first.ref,'Fit']));
  // Tagged PDF structure attributes also use /A; these are not actions.
  pdf.catalog.set(PDFName.of('StructTreeRoot'),pdf.context.obj({Type:'StructTreeRoot',K:[{Type:'StructElem',S:'P',Pg:first.ref,A:{O:'Layout',Placement:'Block'}}]}));
  return Buffer.from(await pdf.save());
}

export async function actionPdf(kind, value, variant = '') {
  const pdf = await PDFDocument.create(), page = pdf.addPage([200,200]);
  const action = kind === 'URI' ? pdf.context.obj({S:kind,URI:PDFString.of(value)}) : kind === 'GoTo' ? pdf.context.obj({S:kind,D:[page.ref,'Fit']}) : kind === 'JavaScript' ? pdf.context.obj({S:kind,JS:PDFString.of('app.alert(1)')}) : pdf.context.obj({S:kind});
  if (variant === 'next') action.set(PDFName.of('Next'), pdf.context.register(pdf.context.obj({S:'JavaScript',JS:PDFString.of('app.alert(1)')})));
  const reference = pdf.context.register(action);
  if (variant === 'cycle') action.set(PDFName.of('Next'),reference);
  if (variant === 'open') pdf.catalog.set(PDFName.of('OpenAction'),reference);
  else page.node.set(PDFName.of('Annots'),pdf.context.obj([{Type:'Annot',Subtype:'Link',Rect:[0,0,20,20],A:reference}]));
  return Buffer.from(await pdf.save());
}
