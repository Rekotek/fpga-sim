// Урок 6, шаг 1: счётчик нажатий S1 на шести светодиодах.
// Кнопка → синхронизатор (2 триггера) → детектор фронта → счётчик +1.
// Антидребезга пока нет: его добавим на занятии 2.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; понадобится антидребезгу
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Полярность кнопки: «нажата = 1» (проверено на плате, PULL_MODE=DOWN в top.cst).
    // Если на другой плате окажется «нажата = 0», поменять здесь 1'b1 на 1'b0 — и всё.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);        // 1 = нажата, при любой полярности

    // Синхронизатор: два триггера подряд. s1_meta может «зависнуть»,
    // s1_sync уже чистый и живёт по нашему такту.
    reg s1_meta = 1'b0, s1_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
    end

    // Детектор фронта: помним значение на прошлом такте.
    reg  s1_prev = 1'b0;
    wire s1_press = s1_sync & ~s1_prev;      // 1 ровно на один такт после нажатия

    always @(posedge clk)
        s1_prev <= s1_sync;

    // Счётчик нажатий: +1 по импульсу s1_press.
    reg [5:0] cnt = 6'd0;

    always @(posedge clk)
        if (s1_press) cnt <= cnt + 1'b1;

    assign led = ~cnt;   // LED0 — младший бит; светодиоды горят по нулю
endmodule
