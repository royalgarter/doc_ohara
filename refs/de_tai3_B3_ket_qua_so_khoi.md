## B3. Kết quả nghiên cứu sơ khởi

Trước khi đề xuất đề tài 3 (Nền tảng AI Agent hỗ trợ chẩn đoán và điều trị), nhóm nghiên cứu đã xây dựng và đánh giá thực nghiệm một nền tảng tiền đề mang tên **OHARA** — framework truy xuất và trực quan hóa tri thức dựa trên cấu trúc **Space-Time Graph**, kết hợp RAG lai đa tín hiệu, ontology grounding, và cơ chế phân tầng có kiểm chứng chéo. Mã nguồn và tài liệu kỹ thuật đầy đủ: https://github.com/royalgarter/doc_ohara

### B3.1. Nền tảng kỹ thuật đã hoàn thiện

OHARA hợp nhất bốn thành phần vào một đồ thị tri thức duy nhất, thay vì xử lý tài liệu dưới dạng chuỗi đoạn văn phẳng (flat-chunk RAG) như phần lớn hệ thống RAG hiện có:

- Cấu trúc phân cấp tài liệu (chương, mục, đoạn văn, bảng biểu).
- Cơ chế suy giảm liên quan theo thời gian (temporal decay), với 4 lớp phân loại và cơ chế bảo vệ nội dung cũ nhưng còn giá trị.
- Ontology grounding (SUMO, 22.700 khái niệm) phục vụ mở rộng truy vấn theo ngữ nghĩa khái niệm.
- Liên kết thực thể xuyên tài liệu (cross-document entity pivot), cho phép suy luận đa bước (multi-hop) qua nhiều nguồn tài liệu khác nhau.

Engine truy xuất vận hành qua 8 pha (lexical BM25, dense vector, ontology overlap, entity pivot, cross-document traversal, structural traversal), hợp nhất bằng cơ chế fusion có trọng số. Kết quả được phân loại vào 3 tầng tin cậy — **Principal** (đã kiểm chứng chéo ≥2 nguồn độc lập), **Integrity** (liên kết trực tiếp với Principal), **Explorer** (gợi ý mở rộng, chưa xác nhận) — mô phỏng đúng quy trình xác minh thông tin của con người (đối chiếu nhiều nguồn trước khi kết luận).

### B3.2. Kết quả thực nghiệm

Đánh giá trên hai bộ dữ liệu chuẩn: QASPER (200 bài báo học thuật, 150 câu hỏi) và MultiHop-RAG (609 bài báo tin tức, 500 câu hỏi bao gồm câu hỏi không có đáp án).

| Chỉ số | Kết quả |
|---|---|
| Chất lượng xếp hạng | Tương đương retrieval dense-vector tốt nhất (Hits@10: 33,3% QASPER, 98,4% MultiHop-RAG) |
| Khả năng từ chối trả lời khi thiếu bằng chứng | Từ chối 45,6% câu hỏi không có đáp án (so với 0,0% của phương pháp cutoff top-k thông thường), vẫn giữ tỷ lệ đúng 91,5% trên câu hỏi có đáp án |
| Chi phí xử lý | ~12 USD / 1.000 tài liệu để xây dựng đồ thị ngữ nghĩa đầy đủ |
| Khả năng mở rộng trực quan hóa | Render tuyến tính đến 12.323 node (3D Space-Time visualization) |

So sánh đối chứng với LightRAG (cùng cấu hình model nền Gemini để loại trừ biến số model): OHARA tương đương trên bài toán đơn tài liệu (QASPER), vượt trội rõ rệt trên bài toán suy luận đa bước xuyên tài liệu (MultiHop-RAG: 96,5–98,4% so với 68,0%) — đúng vào lớp bài toán mà đề tài 3 yêu cầu (tổng hợp thông tin từ nhiều nguồn hồ sơ bệnh án, kết quả cận lâm sàng, y văn).

### B3.3. Liên hệ trực tiếp với yêu cầu đề tài 3

Đề tài 3 yêu cầu xây dựng các Clinical AI Agent (Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation) sử dụng RAG, Medical Knowledge Graph, và Tool Calling để tạo thành hệ thống hỗ trợ quyết định lâm sàng (CDSS). Các thành phần OHARA đã xây dựng và kiểm chứng thực nghiệm ánh xạ trực tiếp vào yêu cầu này:

- **Medical Knowledge Graph**: cấu trúc Space-Time Graph của OHARA (đồ thị tri thức có phân cấp cấu trúc, thời gian, và liên kết thực thể) là nền trực tiếp cho Medical KG — chỉ cần thay ontology SUMO bằng UMLS/RadLex và bổ sung quan hệ nhân quả (causal edge) đặc thù lâm sàng.
- **RAG**: engine truy xuất lai 8 pha tái sử dụng nguyên trạng cho truy xuất văn bản hồ sơ bệnh án điện tử (EHR) — ghi chú lâm sàng, kết quả cận lâm sàng, tóm tắt xuất viện.
- **Tool Calling / Agentic AI**: OHARA đã có sẵn cơ chế agent điều phối công cụ động (`queryAgent`) — tại mỗi bước, mô hình chọn công cụ truy xuất phù hợp (BM25, entity pivot, cross-document, structural traversal) dựa trên trạng thái bằng chứng hiện có. Đây là nền tảng kỹ thuật trực tiếp để mở rộng thành các Clinical AI Agent theo từng chuyên khoa (Radiology, Pharmacy, ICU...), mỗi agent là một cấu hình công cụ và ngữ cảnh riêng trên cùng một kiến trúc.
- **CDSS an toàn theo hướng Retrieval-Only**: cơ chế phân tầng Principal/Integrity/Explorer cùng khả năng chủ động từ chối trả lời khi bằng chứng chưa đủ (45,6% trên câu hỏi không có đáp án) là minh chứng thực nghiệm cho đúng ràng buộc an toàn mà CDSS lâm sàng cần: cung cấp bằng chứng có nguồn gốc rõ ràng (provenance), không tự đưa ra chẩn đoán/quyết định điều trị khi không đủ căn cứ — tránh rơi vào phân loại thiết bị y tế phần mềm rủi ro cao (FDA SaMD Class II).

### B3.4. Kết luận sơ khởi

Kết quả thực nghiệm trên hai bộ dữ liệu chuẩn cho thấy nền tảng OHARA đã kiểm chứng được các thành phần kỹ thuật cốt lõi mà đề tài 3 yêu cầu — đồ thị tri thức có cấu trúc, engine RAG lai đa tín hiệu, cơ chế agent điều phối công cụ, và cơ chế đảm bảo an toàn thông qua từ chối có kiểm soát. Đây là cơ sở kỹ thuật và thực nghiệm sơ khởi để triển khai đề tài 3 theo hướng: mở rộng ontology sang UMLS/RadLex, ingest dữ liệu EHR chuẩn (MIMIC-IV), bổ sung quan hệ nhân quả lâm sàng, và phát triển các Clinical AI Agent chuyên khoa trên nền kiến trúc agent điều phối công cụ đã có.
