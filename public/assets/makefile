all: hg19

hg19: hg19_dbSNP

hg19_dbSNP:
	wget -qO- ftp://ftp.ncbi.nih.gov/snp/organisms/human_9606_b151_GRCh37p13/VCF/common_all_20180423.vcf.gz | gunzip -c | convert2bed --input=vcf --output=bed --do-not-sort - | cut -f1-4 | sort-bed --tmpdir ${PWD} --max-mem 1G - | awk '{ print "chr"$$0 }' > hg19.dbSNP151.common.bed
#	for chr in `bedextract --list-chr hg19.dbSNP151.common.bed`; do echo ${chr}; bedextract ${chr} hg19.dbSNP151.common.bed > hg19.dbSNP151.common.${chr}.bed; done
#	rm hg19.dbSNP151.common.bed
	for chrIdx in $(seq 1 22); do chr="chr${chrIdx}"; echo ${chr}; curl -F 'annotationFile=@/home/ubuntu/hg19.dbSNP151.common.${chr}.bed' -F 'annotationDescription="dbSNP (common v151, hg19)"' -F 'annotationVersion=1' -F 'annotationAssembly="hg19"' -F 'annotationTimestamp=1548189087529' -F 'annotationType="bed4"' "http://localhost:8000/set"; done
