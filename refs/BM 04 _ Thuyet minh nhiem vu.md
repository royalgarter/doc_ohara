**BM-04**

**THUYẾT MINH NHIỆM VỤ**

*(Không quá 20 trang)*

**1\.** **Thông tin chung**

1.1 Tên nhiệm vụ: Nền tảng AI Agent hỗ trợ chẩn đoán và điều trị dựa trên đồ thị tri thức không-thời gian (Space-Time Graph) và truy xuất lai đa tín hiệu

1.2 Mã số (nếu có): …………………………………………………………

1.3 Thời gian thực hiện: …….tháng (từ ....../….. đến……/…….)

1.4 Tổng kinh phí: …………….đồng

**2\.** **Tính cấp thiết**

2.1 Hiện trạng nghiên cứu trong nước và thế giới

*Nêu rõ các nghiên cứu hiện quan, khoảng trống tri thức và/hoặc hiện trạng kỹ thuật, xu thế quốc tế.*

…..

2.2 Sự cần thiết tiến hành nghiên cứu

*Tính mới, ý nghĩa khoa học và thực tiễn, mức độ cấp bách (nếu có).*

…..

2.3. Sự cần thiết thực hiện hợp tác với đối tác nước ngoài (đối với nhiệm vụ hợp tác quốc tế)

…..

**3\.** **Mục tiêu**

*Nêu rõ mục tiêu chung và các mục tiêu cụ thể làm cơ sở xác định nội dung và phương pháp nghiên cứu.*

3.1 Mục tiêu chung:

Xây dựng nền tảng AI Agent hỗ trợ chẩn đoán và điều trị (Clinical Decision Support System - CDSS), vận hành theo nguyên tắc Retrieval-Only có kiểm chứng nguồn gốc (provenance), trên nền một đồ thị tri thức y tế (Medical Knowledge Graph) hợp nhất cấu trúc hồ sơ bệnh án, thời gian tiến triển bệnh, và quan hệ nhân quả lâm sàng, kế thừa và mở rộng trực tiếp từ nền tảng kỹ thuật OHARA đã được xây dựng và đánh giá thực nghiệm.

3.2 Mục tiêu cụ thể:

- Xây dựng Medical Knowledge Graph từ dữ liệu hồ sơ bệnh án điện tử (EHR), mở rộng từ cấu trúc Space-Time Graph 5 thành phần $G=(V,E,\tau,\delta,\sigma)$ sẵn có của OHARA, thay ontology tổng quát (SUMO) bằng ontology y tế chuẩn (UMLS/RadLex) và bổ sung quan hệ nhân quả lâm sàng (time-like/space-like edge).
- Xây dựng engine truy xuất lai đa tín hiệu (RAG) cho văn bản lâm sàng (ghi chú, tóm tắt xuất viện, kết quả cận lâm sàng), tái sử dụng kiến trúc 8 pha (lexical, dense vector, ontology, entity pivot, cross-document, structural) đã kiểm chứng trên hai bộ dữ liệu chuẩn học thuật.
- Xây dựng các Clinical AI Agent chuyên khoa (Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation) trên nền kiến trúc agent điều phối công cụ động (Tool Calling) đã có, mỗi agent là một cấu hình bộ công cụ và ngữ cảnh riêng.
- Xây dựng cơ chế phân tầng kết quả có kiểm chứng chéo (Principal/Integrity/Explorer) và khả năng chủ động từ chối trả lời khi bằng chứng chưa đủ, nhằm đảm bảo CDSS không tự đưa ra chẩn đoán/quyết định điều trị vượt phạm vi an toàn (tránh phân loại rủi ro cao theo FDA SaMD Class II).
- Đánh giá thực nghiệm hệ thống trên bộ dữ liệu MIMIC-IV (hồ sơ EHR chuẩn, công khai) theo các chỉ số chất lượng truy xuất, tỷ lệ từ chối đúng, và hiệu năng agent đa bước.

**4\.** **Nội dung và phương pháp nghiên cứu**

*Những nội dung nghiên cứu cần thực hiện nhằm đạt được mục tiêu và mô tả về thiết kế của từng nội dung nghiên cứu (cách tiếp cận, phương pháp nghiên cứu, kỹ thuật sử dụng). Giải trình sự cần thiết của việc thuê chuyên gia, tổ chức hội thảo, khảo sát, hợp tác trong và ngoài nước (nếu có).*

*Đối với nhiệm vụ hợp tác quốc tế cần làm rõ: các nội dung nghiên cứu và triển khai của phía Việt Nam; nội dung phối hợp nghiên cứu với đối tác nước ngoài; nội dung hoàn thiện và làm chủ kết quả*

**Nội dung 1: Xây dựng Medical Knowledge Graph từ dữ liệu EHR**

Cách tiếp cận: kế thừa cấu trúc Space-Time Graph 5 thành phần $G=(V,E,\tau,\delta,\sigma)$ đã kiểm chứng của OHARA (đồ thị hợp nhất cấu trúc phân cấp tài liệu, suy giảm theo thời gian, và liên kết thực thể xuyên tài liệu).

Phương pháp/kỹ thuật:
- Ingest ghi chú và timeline lâm sàng từ MIMIC-IV vào cấu trúc đồ thị hiện có, tái sử dụng pipeline ingest (LLM structuring, trích xuất thực thể, chuẩn hóa).
- Thay bộ gán nhãn ontology tổng quát (SUMO) bằng bộ trích xuất khái niệm UMLS/RadLex.
- Bổ sung 2 loại quan hệ nhân quả vào tập quan hệ $R$: `precedes_causally` (time-like) và `co_occurs_independent` (space-like), khởi đầu bằng heuristic rule-based (thứ tự thời gian kết hợp prior nhân quả theo mã bệnh), hoãn hình thức hóa toán học đầy đủ (Minkowski) sang giai đoạn sau.
- $\tau$ (ánh xạ thời gian) và $\delta$ (lớp suy giảm) ánh xạ trực tiếp sang vị trí worldline bệnh nhân và tốc độ tiến triển bệnh.

**Nội dung 2: Xây dựng engine RAG lai đa tín hiệu cho văn bản lâm sàng**

Cách tiếp cận: tái sử dụng không đổi engine truy xuất lai 8 pha đã kiểm chứng thực nghiệm trên QASPER và MultiHop-RAG (Hits@10 tương đương dense-vector retrieval tốt nhất).

Phương pháp/kỹ thuật: fusion có trọng số giữa BM25 (lexical), dense vector embedding, overlap ontology (UMLS/RadLex thay SUMO), entity pivot xuyên tài liệu, và structural traversal trên cấu trúc encounter/note của bệnh nhân.

**Nội dung 3: Xây dựng các Clinical AI Agent chuyên khoa (Tool Calling)**

Cách tiếp cận: mở rộng cơ chế agent điều phối công cụ động (`queryAgent`) đã có của OHARA — tại mỗi bước, mô hình chọn công cụ truy xuất phù hợp dựa trên trạng thái bằng chứng hiện có, dừng khi đủ bằng chứng hoặc đạt giới hạn số vòng lặp.

Phương pháp/kỹ thuật: triển khai theo 3 mức tăng dần độ phức tạp:
1. Agent retrieval-only: chỉ chọn chiến lược truy xuất, không tự sinh chẩn đoán/khuyến nghị điều trị.
2. Agent theo vai trò chuyên khoa (Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation): mỗi vai trò là một cấu hình bộ công cụ (tool registry) và ngữ cảnh riêng trên cùng kiến trúc agent.
3. Multi-agent orchestration: điều phối nhiều agent chuyên khoa phối hợp trên cùng một ca bệnh, truyền phát hiện dưới dạng evidence node có nguồn gốc rõ ràng, không phải kết luận cuối cùng.

**Nội dung 4: Cơ chế đảm bảo an toàn CDSS (phân tầng và kiểm chứng chéo)**

Cách tiếp cận: tái sử dụng nguyên trạng cơ chế phân tầng Principal/Integrity/Explorer đã kiểm chứng (từ chối 45,6% câu hỏi không có đáp án so với 0,0% của cutoff top-k thông thường, giữ tỷ lệ đúng 91,5% trên câu hỏi có đáp án).

Phương pháp/kỹ thuật: tầng Principal yêu cầu ≥2 nguồn tín hiệu độc lập và bằng chứng xuyên tài liệu mới được chấp nhận; hệ thống chủ động từ chối trả lời khi bằng chứng chưa đủ, thay vì tự suy diễn — đáp ứng ràng buộc CDSS an toàn (Retrieval-Only, provenance-pointer, tránh phân loại thiết bị y tế rủi ro cao FDA SaMD Class II).

**Nội dung 5: Đánh giá thực nghiệm**

Cách tiếp cận: đo lường trên bộ dữ liệu MIMIC-IV theo phương pháp luận đã áp dụng cho OHARA trên QASPER/MultiHop-RAG (Hits@k, MRR, tỷ lệ Principal-hit, tỷ lệ từ chối đúng trên câu hỏi không có đáp án).

Phương pháp/kỹ thuật: đối chứng với baseline RAG đồ thị hiện có (LightRAG, HippoRAG, cùng cấu hình model nền để cô lập biến số kiến trúc); đánh giá riêng hiệu quả của quan hệ nhân quả (causal edge) trong việc giảm truy xuất chẩn đoán cũ/đã bị bác bỏ so với cơ chế chỉ dùng temporal-decay.

**5\.** **Rủi ro và biện pháp quản lý, kiểm soát**

\- *Nhận diện rủi ro có thể gặp phải và mức độ ảnh hưởng.*

…..

\- *Biện pháp kiểm soát và phương án dự phòng.*

…..

**6\.** **Tiến độ thực hiện**

*Nêu các mốc thời gian quan trọng (dự kiến hoàn thành các nội dung chính, các kết quả trung gian).*

…..

**7\.** **Kết quả dự kiến**

**7.1.** **Dự kiến kết quả nghiên cứu** (cuối cùng)

*Mô tả kết quả nghiên cứu (dự kiến) sẽ đạt được phù hợp với loại hình nhiệm vụ, yêu cầu cần đạt, so sánh với các kết quả, sản phẩm hiện có.*

……

**7.2.** **Dự kiến kết quả công bố, đào tạo**

*Kết quả công bố phải đáp ứng yêu cầu tối thiểu đối với loại hình nhiệm vụ tương ứng.*

| TT | Loại hình4 | Số lượng | Ghi chú |
| :---: | :---: | :---: | :---: |
| 1 |   |   |   |
| … |   |   |   |

**8\. Phương án phối hợp, hợp tác quốc tế, thuê chuyên gia** (nếu có)

*Mô tả đối tác, nội dung hợp tác, vai trò và hình thức phối hợp: tiêu chí lựa chọn chuyên gia trong/ngoài nước.*

…..

**9\. Dự toán kinh phí thực hiện**

9.1 Phương thức khoán chi thực hiện nhiệm vụ: ...

9.2 Tổng kinh phí thực hiện: .... đồng, trong đó,

\- Kinh phí đề nghị Quỹ tài trợ: ...

\- Kinh phí từ nguồn khác: ... trong đó:

\+ NSNN:……..nguồn tài trợ: ...

\+ Ngoài NSNN: …….nguồn tài trợ: ...

Đơn vị: triệu đồng

| TT | Nội dung chi | Tổng kinh phí | Nguồn Quỹ tài trợ |  | Nguồn khác (....) |
| :---: | ----- | :---: | :---: | :---: | :---: |
|  |  |  | Kinh phí | Trong đó khoán chi |   |
| 1 | Tiền thù lao tham gia nhiệm vụ |   |   |   |   |
| 2 | Nguyên liệu, nhiên liệu, vật liệu...5 |   |   |   |   |
| 3 | Sửa chữa, mua sắm, thuê tài sản |   |   |   |   |
| 4 | Chi khác... |   |   |   |   |
|   | *Công tác tổ chức và phí tham gia hội nghị, hội thảo khoa học, diễn đàn, tọa đàm khoa học, công tác phí trong nước và ngoài nước: hợp tác quốc tế (đoàn ra, đoàn vào)* |   |   |   |   |
|   | *Dịch vụ thuê ngoài* |   |   |   |   |
|   | *Điều tra, khảo sát thu thập số liệu* |   |   |   |   |
|   | *Văn phòng phẩm, thông tin liên lạc, in ấn* |   |   |   |   |
|   | *Phí công bố công trình khoa học và công nghệ* |   |   |   |   |
|   | *Tự đánh giá kết quả thực hiện nhiệm vụ* |   |   |   |   |
|   | *Tư vấn xây dựng hồ sơ đăng ký bảo hộ quyền sở hữu trí tuệ* |   |   |   |   |
|   | *Phổ biến, tuyên truyền kết quả của nhiệm vụ* |   |   |   |   |
|   | *Công tác quản lý chung nhiệm vụ (của tổ chức chủ trì)* |   |   |   |   |
|   | *Chi khác có liên quan trực tiếp đến triển khai thực hiện nhiệm vụ* |   |   |   |   |
|   | *Các nội dung chi đặc thù đối với nhiệm vụ đặc biệt/ nhiệm vụ phát triển công nghệ chiến lược* |   |   |   |   |
|   | … |   |   |   |   |
|   | **Tổng** |   |   |   |   |

**11\. Dự kiến hiệu quả đầu ra và tác động của kết quả**

*Mức độ tương xứng giữa kết quả dự kiến đạt được gồm: số lượng sản phẩm, giá trị khoa học, khả năng ứng dụng thực tiễn, phương án chuyển giao thương mại hóa (nếu có) với kinh phí đề nghị tài trợ.*

*Giá trị hợp tác quốc tế (đối với nhiệm vụ hợp tác quốc tế).*

*Dự kiến tác động của kết quả thực hiện nhiệm vụ với phát triển kinh tế \- xã hội.*

 

| ĐẠI DIỆN TỔ CHỨC CHỦ TRÌ(Ký tên, đóng dấu) | CHỦ NHIỆM NHIỆM VỤ(Ký, ghi rõ họ tên) |
| :---: | :---: |

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

4 Bài báo đăng trên tạp chí quốc tế có uy tín Bài báo trong nước/ Bằng sáng chế/ Bằng bảo hộ giống cây trồng/ Giải pháp hữu ích/ Bản quyền phần mềm.... / Đào tạo Ths/ Hỗ trợ Đào tạo TS... 

5 Bao gồm: Nguyên liệu, nhiên liệu, vật liệu, mẫu vật, dụng cụ, phụ tùng, vật rẻ tiền mau hỏng, năng lượng, tài liệu, số liệu, sách, báo, tạp chí tham khảo, quyền sở hữu và sử dụng đối tượng của quyền sở hữu trí tuệ, mua quyền truy cập cơ sở dữ liệu phục vụ thực hiện nhiệm vụ (bao gồm cả chi mua trực tiếp công nghệ, sản phẩm, thiết bị nước ngoài cần thiết cho việc phân tích, giải mã)

