// Ожидаемое поведение: раз в секунду вывод 69 (uart_tx) передаёт строку "Hello, FPGA SIM!"
// с возвратом каретки и переводом строки (18 байтов). Скорость 115 200 бод: делитель 234 даёт
// 115 385 бод, кадр 8N1. Первая строка начинается с первым тактом, между строками линия в покое.
// Проверочное число: за 2,1 с времени симуляции терминал получает строку три раза.
module top (
    input  wire clk,
    output wire uart_tx
);
    localparam integer CLK_HZ  = 27_000_000;
    localparam integer BAUD    = 115_200;
    localparam integer BIT_DIV = CLK_HZ / BAUD;
    localparam integer LEN     = 18;
    localparam [8*LEN-1:0] TEXT = "Hello, FPGA SIM!\015\012";

    reg [24:0] second   = 0;
    reg [7:0]  div      = 0;
    reg [3:0]  bit_idx  = 0;
    reg [4:0]  char_idx = 0;
    reg        busy     = 0;
    reg        tx       = 1;

    // Первый знак строки лежит в старших разрядах.
    wire [7:0] data = TEXT[8*(LEN - 1 - char_idx) +: 8];

    always @(posedge clk) begin
        if (second == CLK_HZ - 1) second <= 0;
        else second <= second + 1'b1;

        if (!busy) begin
            tx <= 1'b1;
            if (second == 0) begin
                busy     <= 1'b1;
                char_idx <= 0;
                bit_idx  <= 0;
                div      <= 0;
            end
        end else begin
            if (div == 0) begin
                if (bit_idx == 0) tx <= 1'b0;
                else if (bit_idx == 9) tx <= 1'b1;
                else tx <= data[bit_idx - 1];
            end
            if (div == BIT_DIV - 1) begin
                div <= 0;
                if (bit_idx == 9) begin
                    bit_idx <= 0;
                    if (char_idx == LEN - 1) busy <= 1'b0;
                    else char_idx <= char_idx + 1'b1;
                end else begin
                    bit_idx <= bit_idx + 1'b1;
                end
            end else begin
                div <= div + 1'b1;
            end
        end
    end

    assign uart_tx = tx;
endmodule
