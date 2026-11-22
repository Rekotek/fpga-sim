// Урок 9, практика 2: по нажатию S1 плата посылает на Mac строку «Hello» и перевод строки.
// Строка хранится в маленькой таблице (ROM) — case в always @(*), как гамма в уроке 8.
// LED0..LED5 показывают, сколько строк отправлено.
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk; тестбенч ставит меньше
    parameter integer BAUD   = 115_200      // скорость UART; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: отправить строку
    output wire       uart_tx,  // UART: от ПЛИС к BL616 и в Mac, вывод 69
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // ---------- Кнопка S1: как в практике 1 ----------
    localparam PRESSED = 1'b1;              // нажата = 1, проверено на плате
    wire s1_in = (btn_s1 == PRESSED);

    reg s1_meta = 1'b0, s1_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
    end

    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // тик раз в 10 мс
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    reg s1_db = 1'b0, s1_prev = 1'b0;

    always @(posedge clk) begin
        if (db_tick) s1_db <= s1_sync;
        s1_prev <= s1_db;
    end

    wire s1_press = s1_db & ~s1_prev;

    // ---------- Строка: таблица из 7 байт ----------
    localparam [2:0] LAST_CHAR = 3'd6;      // номер последнего символа

    reg [2:0] i = 3'd0;                     // номер символа в строке
    reg [7:0] char;                         // НЕ регистр: таблица

    always @(*) begin
        case (i)
            3'd0:    char = "H";
            3'd1:    char = "e";
            3'd2:    char = "l";
            3'd3:    char = "l";
            3'd4:    char = "o";
            3'd5:    char = 8'h0D;          // \r — возврат каретки
            3'd6:    char = 8'h0A;          // \n — новая строка
            default: char = 8'h00;
        endcase
    end

    // ---------- Отправка: по символу, как только передатчик свободен ----------
    reg  sending = 1'b0;                    // 1, пока строка не отправлена целиком
    wire busy;
    wire send = sending & ~busy;            // один такт: передатчик свободен — даём байт

    always @(posedge clk) begin
        if (!sending) begin
            if (s1_press) begin
                sending <= 1'b1;
                i       <= 3'd0;
            end
        end else if (send) begin
            if (i == LAST_CHAR) sending <= 1'b0;   // отдали последний символ
            else                i <= i + 1'b1;
        end
    end

    uart_tx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) tx0 (
        .clk   (clk),
        .start (send),
        .data  (char),
        .tx    (uart_tx),
        .busy  (busy)
    );

    // ---------- Счётчик строк на светодиодах ----------
    reg [5:0] lines = 6'd0;

    always @(posedge clk)
        if (send && i == LAST_CHAR) lines <= lines + 1'b1;

    assign led = ~lines;
endmodule
