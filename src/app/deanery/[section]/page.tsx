import { DeanerySection, type DeanerySearch } from "@/components/deanery-pages";
export default function DeanerySectionPage(props: { params: Promise<{ section: string }>; searchParams: DeanerySearch }) { return <DeanerySection {...props} />; }
